import type { DraftUpsertRequest } from '@superone/shared/environment'
import { userMessageAnswered, type FailedRemoteSend } from '@superone/shared/send-failure'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { buildUpsertFromSession, claimDraftForSession } from '@/stores/chat-store/helpers/draft-promote'
import { projectSandboxFromSettings, sessionFieldsFromSettings, snapshotDraftSettings } from '@/stores/chat-store/helpers/draft-settings'
import { hasFailedFirstSend } from '@/stores/chat-store/helpers/session-liveness'
import { keepFailedSendOriginals } from '@/stores/chat-store/helpers/window-messages'
import { parseRemoteProjectKey } from './remote-project-key'
import { toast } from 'sonner'

// Only failed first turns are retained. A retry keeps its last failure until the host accepts it.
const records = new Map<string, FailedRemoteSend>()
const keyOf = (path: string, id: string) => JSON.stringify([path, id])

export function keepEditedRemoteSend(projectPath: string, sessionId: string, messageId: string): void {
  if (!records.has(keyOf(projectPath, messageId))) return
  const state = useChatStore.getState()
  const project = state.projectSessions[projectPath]
  const draft = buildUpsertFromSession(state, projectPath, sessionId, project._sessions[sessionId], project)
  void resolveFailedRemoteSend(projectPath, messageId, draft)
}

export async function resolveFailedRemoteSend(path: string, id: string, draft?: DraftUpsertRequest): Promise<void> {
  if (!records.size) return
  const key = keyOf(path, id)
  const record = records.get(key)
  if (!record) return
  records.delete(key)
  try {
    await window.environment.resolveFailedRemoteSend(path, id, draft)
  } catch (error) {
    if (!records.has(key)) records.set(key, record)
    toast.error(String(error))
  }
}

function restore(record: FailedRemoteSend): void {
  const { projectPath, sessionId, message, settings, hostSessionOwned } = record
  const key = keyOf(projectPath, message.id)
  const project = useChatStore.getState().projectSessions[projectPath] ?? createDefaultProjectState()
  const current = project._sessions[sessionId]
  records.set(key, record)
  // The host can publish its transcript before the local database read returns.
  const messages = current?.messages ?? []
  const existing = messages.find(row => row.id === message.id)
  if ((existing && !existing.metadata?.sendFailure && existing.providerId !== 'local')
    || (current && userMessageAnswered(current.messages, message.id))) {
    void resolveFailedRemoteSend(projectPath, message.id)
    return
  }
  if (existing && !existing.metadata?.sendFailure) return
  const restored = existing ? keepFailedSendOriginals(existing, message) : message
  if (record.firstSendDraft?.draftId) claimDraftForSession(sessionId, record.firstSendDraft.draftId)
  const session = {
    ...(current ?? createDefaultPerSessionState()),
    ...sessionFieldsFromSettings(settings),
    _title: current?._title ?? record.title,
    _historyHydrated: true,
    cwd: record.cwd,
    hostSessionOwned,
    sandboxInfo: projectSandboxFromSettings(settings) ?? current?.sandboxInfo,
    firstSendDraft: record.firstSendDraft,
    messages: existing ? messages.map(row => row === existing ? restored : row) : [restored, ...messages],
  }
  useChatStore.setState(state => ({ projectSessions: { ...state.projectSessions, [projectPath]: {
    ...project,
    _activeSessionId: project._activeSessionId ?? sessionId,
    _sessions: { ...project._sessions, [sessionId]: session },
  } } }))
}

/** Observe the same store transitions for preparation failures, node refusals and host acknowledgements. */
export function startFailedRemoteSendRecovery(): () => void {
  if (!window.environment?.listFailedRemoteSends) return () => {}
  let stopped = false
  let touchedDuringLoad: Set<string> | null = new Set()
  const stopResolved = window.environment.onFailedRemoteSendResolved((path, id) => {
    const key = keyOf(path, id)
    touchedDuringLoad?.add(key)
    const saved = records.get(key)
    if (!saved) return
    records.delete(key)
    // Another desktop window edited, removed or delivered this same failed message.
    useChatStore.setState(state => {
      const project = state.projectSessions[path]
      const session = project?._sessions[saved.sessionId]
      if (!session?.messages.some(row => row.id === id && row.metadata?.sendFailure)) return state
      const next = { ...session, firstSendDraft: undefined, messages: session.messages.filter(row => row.id !== id) }
      return { projectSessions: { ...state.projectSessions, [path]: {
        ...project, _sessions: { ...project._sessions, [saved.sessionId]: next },
      } } }
    })
  })
  const stop = useChatStore.subscribe((state, before) => {
    if (state.projectSessions === before.projectSessions) return
    for (const [path, project] of Object.entries(state.projectSessions)) {
      const prior = before.projectSessions[path]
      if (project._sessions === prior?._sessions || !parseRemoteProjectKey(path)) continue
      for (const [sessionId, session] of Object.entries(project._sessions)) {
        const old = prior?._sessions[sessionId]
        if (old === session || session._sideChatParentId) continue
        if (old?.messages === session.messages && old?.hostSessionOwned === session.hostSessionOwned) continue
        const first = session.messages[0]
        if (!first || first.role !== 'user') continue
        if (!first.metadata?.sendFailure && !records.size) continue
        const key = keyOf(path, first.id)
        const saved = records.get(key)
        const hosted = !!session.hostSessionOwned
        if (hasFailedFirstSend(session)) {
          if (saved?.message === first && saved.hostSessionOwned === hosted && saved.sessionId === sessionId) continue
          const record: FailedRemoteSend = {
            projectPath: path,
            sessionId,
            hostSessionOwned: hosted,
            firstSendDraft: session.firstSendDraft,
            message: first,
            settings: snapshotDraftSettings(session, project),
            title: session._title,
            cwd: session.cwd,
          }
          records.set(key, record)
          touchedDuringLoad?.add(key)
          void window.environment.saveFailedRemoteSend(record).catch(error => toast.error(String(error)))
        } else if (saved) {
          // Clearing the error to start a retry reuses the original content. Only a
          // replacement from the host, a reply or the send acknowledgement confirms it.
          const received = sessionId === saved.sessionId && first.content !== old?.messages[0]?.content
            && !first.metadata?.sendFailure && first.providerId !== 'local'
          if (received || userMessageAnswered(session.messages, first.id)) {
            void resolveFailedRemoteSend(path, first.id)
          } else if (hosted && (sessionId !== saved.sessionId || !saved.hostSessionOwned)) {
            // A pre-creation retry has a node id now. A restart during delivery must reuse it.
            const moved = { ...saved, sessionId, hostSessionOwned: true, firstSendDraft: undefined }
            records.set(key, moved)
            void window.environment.saveFailedRemoteSend(moved).catch(error => toast.error(String(error)))
          }
        }
      }
    }
  })
  void window.environment.listFailedRemoteSends().then(rows => {
    if (stopped) return
    for (const row of rows) {
      if (!touchedDuringLoad?.has(keyOf(row.projectPath, row.message.id))) restore(row)
    }
  }).catch(error => toast.error(String(error))).finally(() => { touchedDuringLoad = null })
  return () => {
    stopped = true
    stop()
    stopResolved()
    records.clear()
  }
}
