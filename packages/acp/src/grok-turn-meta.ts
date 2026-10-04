/** Grok session/new permission booleans. Ask sends both false. */

export function grokNodePermissionMeta(mode: string | null | undefined): Record<string, unknown> {
  return {
    clientIdentifier: 'superone',
    yoloMode: mode === 'bypassPermissions',
    autoMode: mode === 'auto',
  }
}

/**
 * True for an explicit grok-build launch or a grok binary.
 * A missing agent id on some other command stays a generic ACP agent.
 */
export function isGrokAcpLaunch(launch: { agentId?: string; command: string }): boolean {
  if (launch.agentId === 'grok-build') return true
  const base = launch.command.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  return base === 'grok' || base.startsWith('grok-')
}
