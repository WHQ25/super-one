import { parseRemoteProjectKey } from './remote-project-key'

/**
 * Connection whose Claude and ChatGPT accounts this chat should list.
 * A project path wins over the sidebar host. Null means this machine.
 */
export function subscriptionHost(
  projectPath: string | null | undefined,
  selectedHostConnectionId: string | null | undefined,
): string | null {
  if (projectPath) return parseRemoteProjectKey(projectPath)?.connectionId ?? null
  if (selectedHostConnectionId && selectedHostConnectionId !== 'local') return selectedHostConnectionId
  return null
}

/**
 * Project path the Codex account IPC should use for a provider scope.
 * A local scope never lists a remote project, and a remote scope never lists this machine.
 */
export function codexProjectForScope(projectPath: string | null | undefined, scope: string): string | null {
  if (!projectPath) return null
  const remote = parseRemoteProjectKey(projectPath)
  if (scope === 'local') return remote ? null : projectPath
  return remote?.connectionId === scope ? projectPath : null
}
