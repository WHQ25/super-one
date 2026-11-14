import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/** One harness's in-progress sessions. Streaming and background share the running mark. */
export interface RunningHarnessCount {
  provider: string
  acpAgentId?: string | null
  count: number
}

interface RunningSession {
  status?: string
  sessionProvider?: string | null
  preferredProvider?: string | null
  acpAgentId?: string | null
  _sideChatParentId?: string | null
}

const HARNESS_RANK = ['claude', 'codex', 'acp-grok', 'acp-antigravity', 'opencode', 'cursor', 'dsh', 'acp']

function harnessRank(provider: string): number {
  const index = HARNESS_RANK.indexOf(provider)
  return index === -1 ? HARNESS_RANK.length : index
}

export function isRunningSessionStatus(status: string | undefined): boolean {
  return status === 'streaming' || status === 'background'
}

/** In-progress sessions grouped by harness. Idle, unseen, and side chats stay out. */
export function countRunningByHarness(sessions: Iterable<RunningSession>): RunningHarnessCount[] {
  const counts = new Map<string, RunningHarnessCount>()
  for (const session of sessions) {
    if (session._sideChatParentId || !isRunningSessionStatus(session.status)) continue
    const provider = session.sessionProvider || session.preferredProvider
    if (!provider) continue
    const acpAgentId = session.acpAgentId || null
    const key = `${provider}\x1f${acpAgentId ?? ''}`
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { provider, acpAgentId, count: 1 })
  }
  return [...counts.values()].sort((a, b) => (
    harnessRank(a.provider) - harnessRank(b.provider)
    || b.count - a.count
    || a.provider.localeCompare(b.provider)
    || (a.acpAgentId ?? '').localeCompare(b.acpAgentId ?? '')
  ))
}

export function runningHarnessSignature(sessions: Iterable<RunningSession>): string {
  return countRunningByHarness(sessions)
    .map((row) => `${row.provider}\x1f${row.acpAgentId ?? ''}\x1f${row.count}`)
    .join('\x1e')
}

export function parseRunningHarnessSignature(signature: string): RunningHarnessCount[] {
  if (!signature) return []
  return signature.split('\x1e').map((part) => {
    const [provider, acpAgentId, count] = part.split('\x1f')
    return { provider: provider ?? '', acpAgentId: acpAgentId || null, count: Number(count) || 0 }
  }).filter((row) => row.provider && row.count > 0)
}

type ProjectSessions = Readonly<Record<string, { _sessions?: Readonly<Record<string, RunningSession>> } | undefined>>

/** In-progress sessions on one computer, grouped by harness. */
export function runningHarnessSignatureForConnection(
  projectSessions: ProjectSessions,
  connectionId: string,
  local: boolean,
): string {
  return runningHarnessSignature(function* () {
    for (const [path, project] of Object.entries(projectSessions)) {
      const remote = parseRemoteProjectKey(path)
      if (local ? remote != null : remote?.connectionId !== connectionId) continue
      const sessions = project?._sessions
      if (!sessions) continue
      for (const session of Object.values(sessions)) {
        if (session) yield session
      }
    }
  }())
}
