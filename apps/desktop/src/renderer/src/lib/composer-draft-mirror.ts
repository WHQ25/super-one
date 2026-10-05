import { useChatStore } from '@/stores/chat-store'
import type { PerSessionState } from '@/stores/chat-store/types'
import { findSessionTarget, updatePerSession } from '@/stores/chat-store/helpers/store-helpers'
import { claimDraftForSession, ensureDraftIdForSession, hasDraftContent } from '@/stores/chat-store/helpers/draft-promote'
import { isUnsentSession } from '@/stores/chat-store/helpers/session-liveness'

const MIRRORED_FIELDS = [
  'draftText', 'draftJson', 'attachments', 'browserAnnotations', 'mentions', 'miniAppContexts', 'userSelections',
] as const
type MirroredField = typeof MIRRORED_FIELDS[number]

/** `persistDraftId` keeps an unsent session's autosave in every window on one draft row. */
type ComposerDraftPatch = Partial<Pick<PerSessionState, MirroredField>> & { persistDraftId?: string }

interface Tracked {
  session: PerSessionState
  /** Serialized value each field last held on either side, so a mirrored write
   * (and the editor's echo of it) is not published back to its origin. */
  synced: Partial<Record<MirroredField, string>>
}

function serialize(session: PerSessionState): Tracked['synced'] {
  return Object.fromEntries(MIRRORED_FIELDS.map((field) => [field, JSON.stringify(session[field])]))
}

/**
 * Keep the composer of a session open in several windows (the main window and
 * a spawned mini window) on one draft. Each window publishes its own edits and
 * applies the others' through the main process, which also hands the latest
 * draft to a window that loads the session later.
 */
export function startComposerDraftMirror(): () => void {
  const drafts = new Map<string, ComposerDraftPatch>()
  const tracked = new Map<string, Tracked>()
  let unsubscribe: (() => void) | null = null
  let stopped = false

  const apply = (updates: Array<{ projectPath: string; sessionId: string; patch: ComposerDraftPatch }>) => {
    for (const { sessionId, patch } of updates) {
      if (patch.persistDraftId) claimDraftForSession(sessionId, patch.persistDraftId)
      const entry = tracked.get(sessionId)
      if (!entry) continue
      for (const field of MIRRORED_FIELDS) {
        if (field in patch) entry.synced[field] = JSON.stringify(patch[field])
      }
    }
    useChatStore.setState((state) => {
      let projectSessions = state.projectSessions
      for (const { projectPath, sessionId, patch } of updates) {
        const { persistDraftId: _, ...fields } = patch
        projectSessions = updatePerSession({ ...state, projectSessions }, projectPath, sessionId, () => fields).projectSessions!
      }
      return { projectSessions }
    })
  }

  const scan = () => {
    const adopted: Parameters<typeof apply>[0] = []
    const present = new Set<string>()
    for (const [projectPath, project] of Object.entries(useChatStore.getState().projectSessions)) {
      for (const [sessionId, session] of Object.entries(project._sessions)) {
        present.add(sessionId)
        const entry = tracked.get(sessionId)
        if (entry?.session === session) continue
        if (!entry) {
          // A session that appears here starts from the draft other windows hold.
          tracked.set(sessionId, { session, synced: serialize(session) })
          const draft = drafts.get(sessionId)
          if (draft) adopted.push({ projectPath, sessionId, patch: draft })
          continue
        }
        const previous = entry.session
        entry.session = session
        const patch: ComposerDraftPatch = {}
        for (const field of MIRRORED_FIELDS) {
          if (session[field] === previous[field]) continue
          const value = JSON.stringify(session[field])
          if (value === entry.synced[field]) continue
          entry.synced[field] = value
          Object.assign(patch, { [field]: session[field] })
        }
        if (Object.keys(patch).length === 0) continue
        if (isUnsentSession(session) && hasDraftContent(session)) patch.persistDraftId = ensureDraftIdForSession(sessionId, session)
        drafts.set(sessionId, { ...drafts.get(sessionId), ...patch })
        window.app.publishComposerDraft(sessionId, patch)
      }
    }
    // A session evicted from this store re-adopts the shared draft when it returns.
    for (const sessionId of tracked.keys()) if (!present.has(sessionId)) tracked.delete(sessionId)
    if (adopted.length) apply(adopted)
  }

  const unlisten = window.app.onComposerDraftChanged((sessionId, raw) => {
    const patch = raw as ComposerDraftPatch
    drafts.set(sessionId, { ...drafts.get(sessionId), ...patch })
    if (!unsubscribe || !tracked.has(sessionId)) return
    const target = findSessionTarget(useChatStore.getState(), sessionId)
    if (target) apply([{ ...target, patch }])
  })

  void window.app.getComposerDrafts().then((initial) => {
    if (stopped) return
    for (const [sessionId, patch] of Object.entries(initial)) {
      drafts.set(sessionId, { ...(patch as ComposerDraftPatch), ...drafts.get(sessionId) })
    }
    unsubscribe = useChatStore.subscribe(scan)
    scan()
  })

  return () => {
    stopped = true
    unlisten()
    unsubscribe?.()
  }
}
