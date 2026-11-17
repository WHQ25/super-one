import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import type { ModelOption } from '@superone/shared/agent-types'
import { describeAcpRequestError } from './acp-request-error'
import { readAcpResourcesCache } from './acp-resources-storage'
import type { AcpRuntime } from './acp-runtime'

const UNKNOWN_MODEL_RE = /\bunknown model(?:\s+id|\s+key)?\b/i
const PLAN_MODEL_UNSPECIFIED_RE = /\bplan model not specified\b/i

export const ANTIGRAVITY_WAKEUP_CONTINUATION_PROMPT =
  '[System: Resume stream for pending tool interaction. Follow the tool result or user decision above; if cancelled or denied, stop and wait for the user.]'

export function isDegradedAntigravityModelCatalog(
  agentId: string | null | undefined,
  runtime: Pick<AcpRuntime, 'getConfigOptions' | 'getModelConfig'>,
): boolean {
  if (!isAntigravityAcpAgent(agentId ?? undefined)) return false
  const options = runtime.getConfigOptions() ?? []
  const models = runtime.getModelConfig()?.models ?? []
  return options.length > 0 && models.length === 0
}

export function isAntigravityUnknownModelError(err: unknown): boolean {
  const msg = describeAcpRequestError(err)
  return UNKNOWN_MODEL_RE.test(msg) || PLAN_MODEL_UNSPECIFIED_RE.test(msg)
}

export function buildAntigravityModelCatalogError(requestedModel?: string | null): Error {
  const modelSuffix = requestedModel?.trim() ? ` (cannot select "${requestedModel.trim()}")` : ''
  return new Error(
    `Antigravity failed to load available models from Google Cloud Code${modelSuffix}. Check your network or proxy connection and ensure your proxy region supports Google Cloud Code, then try again.`,
  )
}

export function resolveCachedAntigravityModelFallback(
  preferredModelId?: string | null,
): {
  models: ModelOption[]
  selectedModelId: string | null
  configId: string | null
} | null {
  try {
    const cached = readAcpResourcesCache().modelsByAgentId?.antigravity
    if (!cached || cached.models.length === 0) return null
    const preferred = preferredModelId?.trim() || null
    const selectedModelId =
      preferred && cached.models.some((m) => m.id === preferred)
        ? preferred
        : cached.selectedModelId
    return {
      models: cached.models,
      selectedModelId,
      configId: cached.configId ?? 'model',
    }
  } catch {
    return null
  }
}
