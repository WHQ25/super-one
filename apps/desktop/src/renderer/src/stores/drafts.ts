/**
 * Draft list state, scoped by environment connection.
 *
 * Deliberately its own store rather than a slice of chat-store: chat-store is
 * keyed `Record<projectPath, …>`, while drafts are listed per environment.
 */

import { create } from 'zustand'
import type { DraftListEntry, DraftOpenResult, DraftUpsertRequest } from '@superone/shared/environment'

interface DraftsState {
  /** connectionId → drafts owned by that environment. */
  byConnection: Record<string, DraftListEntry[]>
  /** connectionIds currently loading, so the sidebar can stay quiet on refresh. */
  loading: Record<string, boolean>
  /**
   * Draft the user just clicked, hidden from the list for the whole resume.
   * Resume promotes the outgoing draft *before* it awaits the project switch and
   * only drops this row at the very end, so without this the list would briefly
   * hold both and the group would expand then collapse. UI-only — the row is
   * still on disk until resume actually succeeds.
   */
  resumingDraftId: string | null
  /**
   * Sidebar-deleted ids. A visibility flush / in-flight upsert / list refresh
   * must not put these back — the parked origin session often still has the
   * text, which is how deleted drafts used to reappear.
   */
  discardedIds: Record<string, true>
  setResumingDraft: (draftId: string | null) => void
  markDraftDiscarded: (draftId: string) => void
  isDraftDiscarded: (draftId: string) => boolean
  loadDrafts: (connectionId: string) => Promise<void>
  saveDraft: (connectionId: string, draft: DraftUpsertRequest) => Promise<void>
  /** Drop the row from the list + disk. Resume uses this — do not tombstone. */
  removeDraft: (connectionId: string, draftId: string) => Promise<void>
  /** User deleted this draft. Tombstone so a later flush cannot put it back. */
  discardDraft: (connectionId: string, draftId: string) => Promise<void>
  /** Draft id → lease from `draft.open`. Holding one keeps later saves writable. */
  leases: Record<string, string>
  /** Open a remote draft, remember its lease, and return a copy this composer can edit. */
  openDraft: (connectionId: string, draftId: string) => Promise<DraftListEntry>
  /** Drop a lease after the composer leaves the draft. */
  closeLease: (connectionId: string, draftId: string) => Promise<void>
}

export const useDraftsStore = create<DraftsState>((set, get) => ({
  byConnection: {},
  loading: {},
  resumingDraftId: null,
  discardedIds: {},
  leases: {},

  setResumingDraft: (draftId) => set({ resumingDraftId: draftId }),

  markDraftDiscarded: (draftId) => {
    set((s) => ({ discardedIds: { ...s.discardedIds, [draftId]: true } }))
  },

  isDraftDiscarded: (draftId) => !!get().discardedIds[draftId],

  loadDrafts: async (connectionId) => {
    set((s) => ({ loading: { ...s.loading, [connectionId]: true } }))
    try {
      const discarded = get().discardedIds
      const drafts = (await window.environment.listDrafts(connectionId))
        .filter((d) => !!d.projectPath && !discarded[d.id])
      window.app?.trace?.('drafts', 'load', {
        connectionId,
        count: drafts.length,
        items: drafts.map((d) => ({
          id: d.id,
          harness: d.harness,
          model: d.model,
          permissionMode: d.permissionMode,
          settings: d.settings,
          originSessionId: d.originSessionId,
          textLen: d.text?.length ?? 0,
        })),
      })
      set((s) => ({
        byConnection: {
          ...s.byConnection,
          [connectionId]: drafts.filter((d) => !s.discardedIds[d.id]),
        },
      }))
    } catch {
      // An unreachable environment has no drafts to show. Keep the last known
      // list rather than blanking the group on a transient failure.
    } finally {
      set((s) => ({ loading: { ...s.loading, [connectionId]: false } }))
    }
  },

  openDraft: async (connectionId, draftId) => {
    const opened: DraftOpenResult = await window.environment.openDraft(connectionId, draftId)
    const editable = { ...opened.draft, controllerDeviceId: null }
    set((s) => ({
      leases: { ...s.leases, [draftId]: opened.leaseId },
      byConnection: {
        ...s.byConnection,
        [connectionId]: (s.byConnection[connectionId] ?? []).map((row) => (row.id === draftId ? { ...row, ...editable } : row)),
      },
    }))
    return editable
  },

  closeLease: async (connectionId, draftId) => {
    const leaseId = get().leases[draftId]
    if (!leaseId) return
    if (connectionId !== 'local') await window.environment.closeDraft(connectionId, draftId, leaseId)
    set((s) => {
      if (!s.leases[draftId]) return s
      const leases = { ...s.leases }
      delete leases[draftId]
      return { leases }
    })
  },

  saveDraft: async (connectionId, draft) => {
    if (get().discardedIds[draft.id]) return
    // upsertDraft resolves with the queued projection when the node is down,
    // so the row appears immediately either way.
    const leaseId = get().leases[draft.id]
    const saved = await window.environment.upsertDraft(connectionId, leaseId ? { ...draft, leaseId } : draft)
    if (get().discardedIds[draft.id] || get().discardedIds[saved.id]) {
      // User deleted this row while the upsert was in flight — undo the write
      // so the next list/flush cannot resurrect it.
      void window.environment.deleteDraft(connectionId, saved.id).catch(() => {})
      return
    }
    window.app?.trace?.('drafts', 'save_ipc', {
      sentHarness: draft.harness,
      sentModel: draft.model,
      sentSettings: draft.settings,
      savedHarness: saved.harness,
      savedModel: saved.model,
      savedSettings: saved.settings,
      savedId: saved.id,
    }, saved.id)
    // Main/IPC may omit `settings` on older nodes. Keep the request snapshot
    // so resume still has harness/model/permission/worktree/…
    const merged = {
      ...saved,
      harness: saved.harness ?? draft.harness ?? null,
      model: saved.model ?? draft.model ?? null,
      permissionMode: saved.permissionMode ?? draft.permissionMode ?? null,
      projectPath: saved.projectPath ?? draft.projectPath ?? null,
      settings: { ...(draft.settings ?? {}), ...(saved.settings ?? {}) },
    }
    if (!merged.projectPath) return
    if (get().discardedIds[merged.id]) return
    set((s) => {
      if (s.discardedIds[merged.id]) return s
      const list = s.byConnection[connectionId] ?? []
      const current = list.find((d) => d.id === merged.id)
      const controllerDeviceId = s.leases[merged.id] ? null : (current?.controllerDeviceId ?? merged.controllerDeviceId)
      const next = [{ ...merged, controllerDeviceId }, ...list.filter((d) => d.id !== merged.id)]
      const deduped = merged.originSessionId
        ? next.filter((d) => d.id === merged.id || d.originSessionId !== merged.originSessionId)
        : next
      return { byConnection: { ...s.byConnection, [connectionId]: deduped } }
    })
  },

  removeDraft: async (connectionId, draftId) => {
    await window.environment.deleteDraft(connectionId, draftId)
    set((s) => ({
      byConnection: {
        ...s.byConnection,
        [connectionId]: (s.byConnection[connectionId] ?? []).filter((d) => d.id !== draftId),
      },
    }))
  },

  discardDraft: async (connectionId, draftId) => {
    if (get().byConnection[connectionId]?.find((d) => d.id === draftId)?.controllerDeviceId) {
      throw new Error('Disconnect this draft before deleting it')
    }
    // Tombstone before IPC: a visibility flush / in-flight upsert must not
    // recreate the row. Resume still uses removeDraft so it can be re-promoted.
    get().markDraftDiscarded(draftId)
    try { await get().removeDraft(connectionId, draftId) } catch (error) {
      set((s) => { const discardedIds = { ...s.discardedIds }; delete discardedIds[draftId]; return { discardedIds } })
      throw error
    }
  },
}))

/** Stable empty list so Zustand selectors do not re-render on every read. */
const EMPTY_DRAFTS: DraftListEntry[] = []

/** Drafts for the host the sidebar is currently showing. */
export function selectDraftsFor(connectionId: string) {
  return (s: DraftsState): DraftListEntry[] => s.byConnection[connectionId] ?? EMPTY_DRAFTS
}
