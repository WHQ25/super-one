import { projectRef } from '@superone/shared/environment'
import type { PinnedSessionEntry, SessionHistoryEntry } from '@superone/shared/agent-types'
import type { EnvironmentBucket, HostCheckout } from '@/lib/multi-host/types'

function checkout(environmentId: string, connectionId: string, projectId: string, path: string, repoIdentity: string | null): HostCheckout {
  return {
    ref: projectRef(environmentId, projectId), environmentId, connectionId, projectId,
    name: 'super-one', hostPath: path, pathKey: connectionId === 'local' ? path : `remote:${connectionId}:${path}`,
    repoIdentity, addedAt: 1, lastOpened: 2,
  }
}

export const focusLocal = checkout('desktop', 'local', 'local-project', '/src/super-one', 'git:git@github.com:WHQ25/super-one.git')
export const focusRemote = checkout('server', 'node-1', 'remote-project', '/srv/super-one', 'git:https://github.com/whq25/super-one')
export const focusFork = checkout('server', 'node-1', 'fork', '/srv/fork', 'git:https://github.com/other/super-one')
export const focusEnvironments: EnvironmentBucket[] = [
  { environmentId: 'desktop', connectionId: 'local', label: 'This computer', kind: 'local', connection: 'connected', projectsStatus: 'ready', projectsError: null, checkouts: [focusLocal] },
  { environmentId: 'server', connectionId: 'node-1', label: 'Build server', kind: 'cli-node', connection: 'connected', projectsStatus: 'ready', projectsError: null, checkouts: [focusRemote, focusFork] },
]

export function focusSessionEntry(sessionId: string, title: string): SessionHistoryEntry {
  return { sessionId, title, lastActiveAt: '2026-10-09T00:00:00.000Z', messageCount: 1, provider: 'claude' }
}
export const focusSessions = {
  [focusLocal.pathKey]: [focusSessionEntry('local-active', 'Local active session')],
  [focusRemote.pathKey]: [focusSessionEntry('remote-active', 'Remote active session')],
  [focusFork.pathKey]: [focusSessionEntry('fork-active', 'Unrelated fork session')],
}
export const focusSettled: PinnedSessionEntry[] = [focusLocal, focusRemote].map((checkout) => ({
  ...focusSessionEntry(`${checkout.connectionId}-settled`, `${checkout.connectionId === 'local' ? 'Local' : 'Remote'} settled session`),
  folderPath: checkout.pathKey, folderName: checkout.name, isSettled: true,
}))
