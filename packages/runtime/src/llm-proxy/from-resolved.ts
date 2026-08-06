/**
 * Build a ProxyUpstream from a ResolvedService when protocol is non-native
 * (openai-chat for Claude Messages / Codex Responses harnesses).
 */

import type { ResolvedService } from '@superone/shared/platform-registry'
import { resolveCodexChatReasoning } from './codex-responses/reasoning'
import type { ProxyUpstream } from './types'

/**
 * When `resolved.protocol` is `openai-chat`, return a proxy upstream that
 * bridges the harness-native wire format to Chat Completions.
 * Returns null for native protocols (anthropic-messages / openai-responses).
 */
export function proxyUpstreamFromResolved(resolved: ResolvedService): ProxyUpstream | null {
  if (resolved.protocol !== 'openai-chat') return null

  const apiBase = resolved.baseUrl.replace(/\/$/, '')
  const chatUrl = apiBase.endsWith('/chat/completions')
    ? apiBase
    : `${apiBase}/chat/completions`

  const modelMapping = resolved.modelMapping ?? {}
  const models = [
    ...new Set(
      [
        ...Object.values(modelMapping).map((s) => s?.id?.replace(/\[1m\]/i, '')),
        ...(resolved.models ?? []).map((m) => m.id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]

  const transformersRaw =
    (resolved.extraEnv ?? {}).SUPERONE_PROXY_TRANSFORMERS ?? 'openai,reasoning'

  return {
    name: resolved.brand || resolved.platformId,
    api_base_url: chatUrl,
    api_key: resolved.apiKey,
    models,
    transformerUse: transformersRaw.split(',').map((t) => t.trim()).filter(Boolean),
    reasoningConfig: resolveCodexChatReasoning(resolved.platformId),
  }
}

/** Placeholder API key the harness process uses; the proxy holds the real key. */
export const PROXY_HARNESS_API_KEY = 'sk-superone-proxy'
