export const ACP_SESSION_SET_MODEL = 'session/set_model'

export interface AcpAgentCapabilities {
  loadSession: boolean
  mcp: { http: boolean; sse: boolean; acp: boolean }
  sessionCapabilities: { additionalDirectories: boolean }
}

function isAntigravityInitializeResult(
  root: Record<string, unknown>,
  caps: Record<string, unknown>,
): boolean {
  const meta =
    caps._meta && typeof caps._meta === 'object' && !Array.isArray(caps._meta)
      ? (caps._meta as Record<string, unknown>)
      : null
  if (meta?.antigravity && typeof meta.antigravity === 'object') {
    return true
  }
  const agentInfo =
    root.agentInfo && typeof root.agentInfo === 'object' && !Array.isArray(root.agentInfo)
      ? (root.agentInfo as Record<string, unknown>)
      : null
  return typeof agentInfo?.name === 'string' && /antigravity/i.test(agentInfo.name)
}

export function readAgentCapabilities(result: unknown): AcpAgentCapabilities | null {
  if (!result || typeof result !== 'object') return null
  const root = result as Record<string, unknown>
  const caps = root.agentCapabilities
  if (!caps || typeof caps !== 'object') return null
  const c = caps as Record<string, unknown>
  const mcp = (c.mcpCapabilities ?? {}) as Record<string, unknown>
  const session = (c.sessionCapabilities ?? {}) as Record<string, unknown>
  const antigravityHttp = isAntigravityInitializeResult(root, c)
  return {
    loadSession: c.loadSession === true,
    mcp: {
      http: mcp.http === true || antigravityHttp,
      sse: mcp.sse === true,
      acp: mcp.acp === true,
    },
    sessionCapabilities: {
      additionalDirectories: !!session.additionalDirectories,
    },
  }
}

export interface AcpSetModelOptions {
  reasoningEffort?: string
  contextWindow?: number
}

export function buildSetModelParams(
  sessionId: string,
  modelId: string,
  opts?: AcpSetModelOptions,
): Record<string, unknown> {
  const effort = opts?.reasoningEffort?.trim()
  const meta: Record<string, unknown> = {}
  if (effort) meta.reasoningEffort = effort
  if (opts?.contextWindow != null && Number.isFinite(opts.contextWindow)) {
    meta.contextWindow = opts.contextWindow
  }
  return {
    sessionId,
    modelId,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  }
}
