export interface AcpAgentDefinition {
  id: string
  name: string
  command: string
  args: string[]
  harnessId: 'acp-grok' | 'acp-antigravity' | 'opencode'
  installHint?: string
}

export const BUILTIN_ACP_AGENTS: AcpAgentDefinition[] = [
  {
    id: 'grok-build',
    name: 'Grok Build',
    command: 'grok',
    args: ['agent', 'stdio'],
    harnessId: 'acp-grok',
    installHint: 'Install Grok Build CLI, or set command to: npx -y @xai-official/grok agent stdio',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    command: 'agy',
    args: ['acp'],
    harnessId: 'acp-antigravity',
    installHint: 'Install Antigravity CLI (agy on PATH or ~/.local/bin/agy)',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    harnessId: 'opencode',
    installHint: 'Install OpenCode CLI with ACP support (`opencode` on PATH)',
  },
]

export function getBuiltinAgent(id: string): AcpAgentDefinition | undefined {
  return BUILTIN_ACP_AGENTS.find((a) => a.id === id)
}

/** Catalog snapshot for UI/cache when detection has not run yet. */
export function listBuiltinAgentDescriptors(installed = false): Array<{
  id: string
  name: string
  installed: boolean
  commandPreview: string
}> {
  return BUILTIN_ACP_AGENTS.map((def) => ({
    id: def.id,
    name: def.name,
    installed,
    commandPreview: [def.command, ...def.args].join(' '),
  }))
}

export interface ResolvedAcpLaunch {
  agentId: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

export function resolveAcpLaunch(input: {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  defaultCwd: string
}): ResolvedAcpLaunch {
  const agentId = input.agentId?.trim() || 'grok-build'
  const builtin = getBuiltinAgent(agentId)
  if (!builtin) throw new Error(`Unknown ACP agent "${agentId}"`)
  const command = input.command?.trim() || builtin.command
  return {
    agentId,
    command,
    args: input.args ?? builtin.args,
    env: input.env ?? {},
    cwd: input.cwd?.trim() || input.defaultCwd,
  }
}
