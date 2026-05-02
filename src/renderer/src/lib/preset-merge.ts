import { type QuickPreset } from './provider-presets'
import {
  parseProviderModelEnv,
  type AgentProviderConfig,
  type ApiProvider,
  type ProviderModelEnv,
  type ProviderModelSlot,
  type ModelBucket,
  MODEL_BUCKETS,
} from '../../../shared/agent-types'

export interface ExtraEnvChange { key: string; from: string; to: string }
export interface ModelSlotChange { slot: ModelBucket; from: ProviderModelSlot; to: ProviderModelSlot }

export interface AgentDiff {
  agent: string
  extraEnvAdded: Record<string, string>
  extraEnvChanged: ExtraEnvChange[]
  modelEnvSlotsAdded: Partial<Record<ModelBucket, ProviderModelSlot>>
  modelEnvSlotsChanged: ModelSlotChange[]
  baseUrlMismatch?: { current: string; preset: string }
}

export interface PresetSyncDiff {
  presetKey: string
  presetName: string
  perAgent: AgentDiff[]
  supportedAgentsAdded: string[]
  hasChanges: boolean
}

function parseExtraEnv(raw: string | undefined): Record<string, string> {
  try {
    const obj = JSON.parse(raw || '{}')
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = String(v)
    return out
  } catch {
    return {}
  }
}

function modelSlotsEqual(a: ProviderModelSlot | undefined, b: ProviderModelSlot | undefined): boolean {
  if (!a || !b) return false
  return a.id === b.id && (a.name ?? '') === (b.name ?? '') && (a.description ?? '') === (b.description ?? '')
}

export function diffProviderAgainstPreset(
  provider: ApiProvider,
  preset: QuickPreset,
): PresetSyncDiff {
  let configs: Record<string, AgentProviderConfig> = {}
  try { configs = JSON.parse(provider.agent_configs || '{}') } catch { /* ignore */ }

  const supportedAgents: string[] = (() => {
    try { return JSON.parse(provider.supported_agents || '["claude"]') } catch { return ['claude'] }
  })()

  const perAgent: AgentDiff[] = []
  for (const [agent, presetCfg] of Object.entries(preset.agent_configs)) {
    if (!presetCfg) continue
    const dbCfg = configs[agent]
    const dbExtra = parseExtraEnv(dbCfg?.extra_env)
    const presetExtra = parseExtraEnv(presetCfg.extra_env)

    const extraEnvAdded: Record<string, string> = {}
    const extraEnvChanged: ExtraEnvChange[] = []
    for (const [k, v] of Object.entries(presetExtra)) {
      if (!(k in dbExtra)) {
        extraEnvAdded[k] = v
      } else if (dbExtra[k] !== v) {
        extraEnvChanged.push({ key: k, from: dbExtra[k], to: v })
      }
    }

    const dbModelEnv: ProviderModelEnv = dbCfg ? parseProviderModelEnv(dbCfg.model_env) : {}
    const presetModelEnv: ProviderModelEnv = presetCfg.model_env ?? {}
    const modelEnvSlotsAdded: Partial<Record<ModelBucket, ProviderModelSlot>> = {}
    const modelEnvSlotsChanged: ModelSlotChange[] = []
    for (const bucket of MODEL_BUCKETS) {
      const presetSlot = presetModelEnv[bucket]
      const dbSlot = dbModelEnv[bucket]
      if (!presetSlot) continue
      if (!dbSlot) {
        modelEnvSlotsAdded[bucket] = presetSlot
      } else if (!modelSlotsEqual(dbSlot, presetSlot)) {
        modelEnvSlotsChanged.push({ slot: bucket, from: dbSlot, to: presetSlot })
      }
    }

    let baseUrlMismatch: AgentDiff['baseUrlMismatch']
    const presetBase = (presetCfg.base_url ?? '').trim()
    const dbBase = (dbCfg?.base_url ?? '').trim()
    if (presetBase && dbBase && presetBase !== dbBase) {
      baseUrlMismatch = { current: dbBase, preset: presetBase }
    }

    const agentHasAny = Object.keys(extraEnvAdded).length > 0
      || extraEnvChanged.length > 0
      || Object.keys(modelEnvSlotsAdded).length > 0
      || modelEnvSlotsChanged.length > 0
      || !!baseUrlMismatch
    if (agentHasAny) {
      perAgent.push({ agent, extraEnvAdded, extraEnvChanged, modelEnvSlotsAdded, modelEnvSlotsChanged, baseUrlMismatch })
    }
  }

  const supportedAgentsAdded = preset.supported_agents.filter((a) => !supportedAgents.includes(a))

  const hasChanges = perAgent.length > 0 || supportedAgentsAdded.length > 0

  return {
    presetKey: preset.key,
    presetName: preset.name,
    perAgent,
    supportedAgentsAdded,
    hasChanges,
  }
}

export function applyPresetSync(
  provider: ApiProvider,
  preset: QuickPreset,
  diff: PresetSyncDiff,
): { agent_configs: string; supported_agents: string } {
  let configs: Record<string, AgentProviderConfig> = {}
  try { configs = JSON.parse(provider.agent_configs || '{}') } catch { /* ignore */ }

  for (const agentDiff of diff.perAgent) {
    const presetCfg = preset.agent_configs[agentDiff.agent as keyof typeof preset.agent_configs]
    const cfg = configs[agentDiff.agent] ?? {
      base_url: presetCfg?.base_url ?? '',
      model_env: '{}',
      extra_env: '{}',
      api_format: presetCfg?.api_format ?? 'anthropic',
    }

    if (Object.keys(agentDiff.extraEnvAdded).length > 0 || agentDiff.extraEnvChanged.length > 0) {
      const extra = parseExtraEnv(cfg.extra_env)
      for (const [k, v] of Object.entries(agentDiff.extraEnvAdded)) {
        if (!(k in extra)) extra[k] = v
      }
      for (const change of agentDiff.extraEnvChanged) {
        extra[change.key] = change.to
      }
      cfg.extra_env = JSON.stringify(extra)
    }

    if (Object.keys(agentDiff.modelEnvSlotsAdded).length > 0 || agentDiff.modelEnvSlotsChanged.length > 0) {
      const me = parseProviderModelEnv(cfg.model_env)
      for (const [bucket, slot] of Object.entries(agentDiff.modelEnvSlotsAdded)) {
        if (slot && !me[bucket as ModelBucket]) me[bucket as ModelBucket] = slot
      }
      for (const change of agentDiff.modelEnvSlotsChanged) {
        me[change.slot] = change.to
      }
      cfg.model_env = JSON.stringify(me)
    }

    if (agentDiff.baseUrlMismatch) {
      cfg.base_url = agentDiff.baseUrlMismatch.preset
    }

    configs[agentDiff.agent] = cfg
  }

  let supportedAgents: string[] = ['claude']
  try { supportedAgents = JSON.parse(provider.supported_agents || '["claude"]') } catch { /* ignore */ }
  for (const a of diff.supportedAgentsAdded) {
    if (!supportedAgents.includes(a)) supportedAgents.push(a)
  }

  return {
    agent_configs: JSON.stringify(configs),
    supported_agents: JSON.stringify(supportedAgents),
  }
}
