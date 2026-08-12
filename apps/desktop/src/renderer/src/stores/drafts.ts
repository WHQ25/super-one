/**
 * Draft list state, scoped by environment connection.
 *
 * Deliberately its own store rather than a slice of chat-store: chat-store is
 * keyed `Record<projectPath, …>`, while drafts are listed per environment.
 */

import { create } from 'zustand'
import type { DraftListEntry, DraftUpsertRequest } from '@superone/shared/environment'

interface DraftsState {
  /** connectionId → drafts owned by that environment. */
  byConnection: Record<string, DraftListEntry[]>
  /** connectionIds currently loading, so the sidebar can stay quiet on refresh. */
  loading: Record<string, boolean>
  loadDrafts: (connectionId: string) => Promise<void>
  saveDraft: (connectionId: string, draft: DraftUpsertRequest) => Promise<void>
  removeDraft: (connectionId: string, draftId: string) => Promise<void>
}

export const useDraftsStore = create<DraftsState>((set) => ({
  byConnection: {},
  loading: {},

  loadDrafts: async (connectionId) => {
    set((s) => ({ loading: { ...s.loading, [connectionId]: true } }))
    try {
      const drafts = (await window.environment.listDrafts(connectionId))
        .filter((d) => !!d.projectPath)
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
      set((s) => ({ byConnection: { ...s.byConnection, [connectionId]: drafts } }))
    } catch {
      // An unreachable environment has no drafts to show. Keep the last known
      // list rather than blanking the group on a transient failure.
    } finally {
      set((s) => ({ loading: { ...s.loading, [connectionId]: false } }))
    }
  },

  saveDraft: async (connectionId, draft) => {
    // upsertDraft resolves with the queued projection when the node is down,
    // so the row appears immediately either way.
    const saved = await window.environment.upsertDraft(connectionId, draft)
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
    set((s) => {
      const list = s.byConnection[connectionId] ?? []
      const next = [merged, ...list.filter((d) => d.id !== merged.id)]
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
}))

/** Stable empty list so Zustand selectors do not re-render on every read. */
const EMPTY_DRAFTS: DraftListEntry[] = []

/** Drafts for the host the sidebar is currently showing. */
export function selectDraftsFor(connectionId: string) {
  return (s: DraftsState): DraftListEntry[] => s.byConnection[connectionId] ?? EMPTY_DRAFTS
}
