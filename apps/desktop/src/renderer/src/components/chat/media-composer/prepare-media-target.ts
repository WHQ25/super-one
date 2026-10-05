import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
const preparing = new Map<string, Promise<SessionWriteTarget | null>>()

/** A remote draft needs a real node session before its generated files can be delivered. */
export async function prepareMediaTarget(target: SessionWriteTarget, signal?: AbortSignal): Promise<SessionWriteTarget | null> {
  const remote = parseRemoteProjectKey(target.projectPath)
  if (!remote || signal?.aborted) return signal?.aborted ? null : target
  const key = JSON.stringify([target.projectPath, target.sessionId])
  let work = preparing.get(key)
  if (!work) {
    work = prepareRemoteTarget(target).finally(() => preparing.delete(key))
    preparing.set(key, work)
  }
  const owner = await work
  return signal?.aborted ? null : owner
}

async function prepareRemoteTarget(target: SessionWriteTarget): Promise<SessionWriteTarget | null> {
  const remote = parseRemoteProjectKey(target.projectPath)!
  const snapshot = await window.environment.getSession(remote.connectionId, target.sessionId)
  if (snapshot) return target
  const previous = useChatStore.getState().projectSessions[target.projectPath]?._sessions[target.sessionId]
  if (!previous) return null
  if (previous.hostSessionOwned || previous.messages.length) throw new Error('Remote media session no longer exists')
  const { resolveRemoteProjectId } = await import('@/lib/remote-session-ops')
  const projectId = await resolveRemoteProjectId(target.projectPath)
  if (!projectId) throw new Error('Remote project no longer exists')
  const harnessId = previous.sessionProvider ?? previous.preferredProvider ?? 'claude'
  const created = await window.environment.createSession(remote.connectionId, { projectId, harnessId, providerId: harnessId })
  let adopted = false
  // Preserve edits and navigation that happened while the node was being contacted.
  useChatStore.setState(state => {
    const project = state.projectSessions[target.projectPath]
    const draft = project?._sessions[target.sessionId]
    if (!draft) return state
    adopted = true
    const sessions = { ...project._sessions }
    delete sessions[target.sessionId]
    sessions[created.sessionId] = { ...draft, hostSessionOwned: true, _historyHydrated: true, sessionProvider: harnessId }
    return { projectSessions: { ...state.projectSessions, [target.projectPath]: { ...project,
      _sessions: sessions, _activeSessionId: project._activeSessionId === target.sessionId ? created.sessionId : project._activeSessionId,
      _previousSessionId: project._previousSessionId === target.sessionId ? created.sessionId : project._previousSessionId,
    } } }
  })
  if (!adopted) return null
  const { useMosaicStore } = await import('@/components/mosaic/mosaic-store')
  useMosaicStore.getState().replaceTileSession(target.projectPath, target.sessionId, created.sessionId)
  return { ...target, sessionId: created.sessionId }
}
