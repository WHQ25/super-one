import type { ResolvedService } from './types'

/**
 * Platforms whose Anthropic Messages endpoint Claude Code itself recognises:
 * Anthropic's own API/login, or the Bedrock/Vertex backends it detects from
 * `CLAUDE_CODE_USE_*`. Every other platform is an Anthropic-compatible host the
 * CLI cannot tell apart from `api.anthropic.com`.
 */
const CLI_KNOWN_BRANDS = new Set(['anthropic', 'claude', 'bedrock', 'vertexai'])

/**
 * Claude Code env defaults for an Anthropic-compatible endpoint Anthropic does
 * not serve. The CLI treats any `ANTHROPIC_BASE_URL` as first party and, for a
 * model id it does not recognise, assumes the newest wire features — so once
 * an MCP server joins mid-session it emits `tool_addition` blocks
 * (`mid-conversation-tool-changes` beta) that third-party hosts reject with a
 * 400 on every later turn. `CLAUDE_CODE_MODEL_CAPABILITIES` is the CLI's
 * per-model capability override (`;`-separated `[model=]cap,-cap` entries; no
 * `model=` applies to all); denying just that capability keeps ToolSearch and
 * the other 3P-safe betas intact. Layer it under the platform/credential
 * `extraEnv` so an endpoint can still opt back in.
 */
export function claudeThirdPartyEnv(resolved: Pick<ResolvedService, 'brand'>): Record<string, string> {
  if (CLI_KNOWN_BRANDS.has(resolved.brand)) return {}
  return { CLAUDE_CODE_MODEL_CAPABILITIES: '-mid_conv_tool_change' }
}
