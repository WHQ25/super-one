import type { DraftChangedEvent } from '@superone/shared/environment/draft-rpc'
import { useChatStore } from '@/stores/chat-store'
import { useDraftsStore } from '@/stores/drafts'
import { useAppStore } from '@/stores/app'
import { buildUpsertFromSession, claimDraftForSession, discardDeletedDraft, getDraftIdForSession, hasDraftContent, isUnsentSession, projectSandboxFromSettings, resolveDraftTarget, sessionFieldsFromSettings } from '@/stores/chat-store/helpers/draft-promote'

const pendingWrites = new Map<string, () => Promise<void>>()
const inFlightWrites = new Map<string, Promise<void>>()
let applyingDraftId: string | null = null

export async function flushDraftBeforeOpen(draftId: string): Promise<void> {
  while (pendingWrites.has(draftId) || inFlightWrites.has(draftId)) {
    const flush = pendingWrites.get(draftId)
    if (flush) await flush()
    else await inFlightWrites.get(draftId)
  }
}

/** Apply remote content only to its own unsent origin. Local save echoes must
 * never replace keystrokes entered while the IPC response was in flight. */
export function applyDraftChange(event: DraftChangedEvent): void {
  const { draft, draftId } = event
  const previous = useDraftsStore.getState().byConnection.local?.find((row) => row.id === draftId)
  useDraftsStore.setState((s) => ({ byConnection: { ...s.byConnection,
    local: [...(draft ? [draft] : []), ...(s.byConnection.local ?? []).filter((row) => row.id !== draftId)],
  } }))
  if (!draft) {
    useChatStore.setState((state) => {
      const next = { ...state }
      discardDeletedDraft(draftId, next)
      return { projectSessions: next.projectSessions }
    })
    return
  }
  if (!draft.controllerDeviceId && !previous?.controllerDeviceId && event.reason === 'saved') return
  applyingDraftId = draftId
  useChatStore.setState((s) => {
    const projectSessions = { ...s.projectSessions }
    for (const [path, project] of Object.entries(projectSessions)) {
      if (resolveDraftTarget(path).connectionId !== 'local') continue
      let sessions = project._sessions
      for (const [sid, session] of Object.entries(sessions)) {
        if (!isUnsentSession(session) || (session.draftId !== draftId && sid !== draft.originSessionId)) continue
        claimDraftForSession(sid, draftId)
        sessions = { ...sessions, [sid]: { ...session,
          ...sessionFieldsFromSettings(draft.settings), draftId,
          draftRemoteDeviceId: draft.controllerDeviceId ?? null,
          draftText: draft.text, draftJson: draft.docJson,
          attachments: draft.attachments.map(({ data, ...attachment }) => ({ ...attachment, base64: data })),
        } }
      }
      if (sessions !== project._sessions) projectSessions[path] = {
        ...project, _sessions: sessions, sandboxInfo: projectSandboxFromSettings(draft.settings) ?? project.sandboxInfo,
      }
    }
    return { projectSessions }
  })
  if (draft.projectPath && useChatStore.getState().activeProject === draft.projectPath) {
    const project = useChatStore.getState().projectSessions[draft.projectPath]
    if (project?._activeSessionId && project._sessions[project._activeSessionId]?.draftId === draft.id) {
      const settings = draft.settings
      useAppStore.setState((s) => ({ _worktrees: { ...s._worktrees, [draft.projectPath!]: {
        pendingBaseBranch: settings.pendingBaseBranch ?? null,
        pendingMode: settings.pendingWorktreeMode === 'attach' || settings.pendingWorktreeMode === 'detach' ? settings.pendingWorktreeMode : 'branch',
        pendingBranchName: settings.pendingBranchName ?? '', pendingCarryLocalChanges: !!settings.pendingCarryLocalChanges,
        activePath: settings.worktreePath ?? null,
      } } }))
    }
  }
  applyingDraftId = null
}

/** Persist open composers as well as parked ones. A signature excludes stream
 * state so agent events do not write drafts or restart their debounce. */
export function startDraftAutosave(): () => void {
  const signatures = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const scan = () => {
    const store = useChatStore.getState()
    for (const [path, project] of Object.entries(store.projectSessions)) {
      for (const [sid, session] of Object.entries(project._sessions)) {
        const knownId = session.draftId ?? getDraftIdForSession(sid)
        if (!isUnsentSession(session) || session.draftRemoteDeviceId) {
          clearTimeout(timers.get(sid)); timers.delete(sid); signatures.delete(sid)
          if (knownId) pendingWrites.delete(knownId)
          continue
        }
        if (!hasDraftContent(session) && !knownId) continue
        const worktree = useAppStore.getState()._worktrees[path]
        const input = buildUpsertFromSession(store, path, sid, session, project, worktree ? {
          path: worktree.activePath, pendingBaseBranch: worktree.pendingBaseBranch,
          pendingMode: worktree.pendingMode, pendingBranchName: worktree.pendingBranchName,
          pendingCarryLocalChanges: worktree.pendingCarryLocalChanges,
        } : null)
        if (useDraftsStore.getState().isDraftDiscarded(input.id)) continue
        const signature = JSON.stringify(input)
        if (signatures.get(sid) === signature) continue
        signatures.set(sid, signature)
        clearTimeout(timers.get(sid))
        if (applyingDraftId === input.id) { pendingWrites.delete(input.id); continue }
        const write = async () => {
          if (pendingWrites.get(input.id) !== write) return
          pendingWrites.delete(input.id)
          clearTimeout(timers.get(sid)); timers.delete(sid)
          const previous = inFlightWrites.get(input.id)
          const task = (async () => {
            await previous
            const latest = useChatStore.getState().projectSessions[path]?._sessions[sid]
            if (!isUnsentSession(latest) || latest?.draftRemoteDeviceId) return
            await useDraftsStore.getState().saveDraft(resolveDraftTarget(path).connectionId, input)
            useChatStore.setState((s) => {
              const p = s.projectSessions[path], row = p?._sessions[sid]
              if (!p || !row || row.draftId === input.id || !isUnsentSession(row)) return s
              return { projectSessions: { ...s.projectSessions, [path]: { ...p, _sessions: { ...p._sessions, [sid]: { ...row, draftId: input.id } } } } }
            })
          })()
          inFlightWrites.set(input.id, task)
          try { await task } finally { if (inFlightWrites.get(input.id) === task) inFlightWrites.delete(input.id) }
        }
        pendingWrites.set(input.id, write)
        timers.set(sid, setTimeout(() => { void write().catch(() => { signatures.delete(sid) }) }, 250))
      }
    }
  }
  const unchat = useChatStore.subscribe(scan)
  const unapp = useAppStore.subscribe((s, previous) => { if (s._worktrees !== previous._worktrees) scan() })
  scan()
  return () => { unchat(); unapp(); for (const timer of timers.values()) clearTimeout(timer); pendingWrites.clear() }
}
