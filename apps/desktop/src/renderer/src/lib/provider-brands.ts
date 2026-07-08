import { PRESETS, type QuickPreset } from './provider-presets'
import { getPresetByKey, resolvePresetKey } from './preset-match'
import type { AgentProviderConfig, ApiProvider } from '@superone/shared/agent-types'

export const CUSTOM_API_PRESET_KEY = 'custom-api'
export const DRAFT_CUSTOM_BRAND_ID = '__draft_custom__'

export interface ProviderBrand {
  brandId: string
  presetKey: string
  name: string
  presets: QuickPreset[]
  providers: ApiProvider[]
  apiKeyUrl?: string
  editableName: boolean
  regionLabel?: string
}

const customApiPreset = PRESETS.find((p) => p.key === CUSTOM_API_PRESET_KEY)!

function customBrandIdForName(name: string): string {
  return `custom:${name.trim().toLowerCase()}`
}

/** Region variant a preset targets, if any — used to keep CN and Global apart within a platform. */
function regionOf(preset: QuickPreset): 'cn' | 'global' | null {
  if (/-cn$/.test(preset.key) || /\(cn\)/i.test(preset.name)) return 'cn'
  if (/-global$/.test(preset.key) || /\(global\)/i.test(preset.name)) return 'global'
  return null
}

/** Platform brand id: one row per platform, split only by region (CN/Global), not by tier (coding plan vs API). */
function brandIdOf(preset: QuickPreset): string {
  if (preset.provider_type === 'custom') return preset.key
  const region = regionOf(preset)
  return region ? `${preset.provider_type}:${region}` : preset.provider_type
}

/** Display name without the tier qualifier (Coding / API / Token Plan), keeping the region tag. */
function platformName(preset: QuickPreset): string {
  return preset.name.replace(/\s*\((coding|api|token plan)\)\s*/i, '').trim()
}

/** Brand id a provider falls under; providers matching no preset are grouped by name (same name = same provider). */
export function providerBrandId(provider: ApiProvider): string {
  const presetKey = resolvePresetKey(provider)
  const preset = presetKey ? getPresetByKey(presetKey) : undefined
  if (preset && preset.key !== CUSTOM_API_PRESET_KEY) return brandIdOf(preset)
  return customBrandIdForName(provider.name)
}

export function buildProviderBrands(providers: ApiProvider[]): ProviderBrand[] {
  const order: string[] = []
  const byId = new Map<string, ProviderBrand>()

  for (const preset of PRESETS) {
    if (preset.provider_type === 'custom') continue
    const brandId = brandIdOf(preset)
    let brand = byId.get(brandId)
    if (!brand) {
      const region = regionOf(preset)
      brand = {
        brandId,
        presetKey: preset.key,
        name: platformName(preset),
        presets: [],
        providers: [],
        apiKeyUrl: preset.apiKeyUrl,
        editableName: false,
        regionLabel: region === 'cn' ? 'CN' : region === 'global' ? 'Global' : undefined,
      }
      byId.set(brandId, brand)
      order.push(brandId)
    }
    brand.presets.push(preset)
  }

  for (const provider of providers) {
    const brandId = providerBrandId(provider)
    let brand = byId.get(brandId)
    if (!brand) {
      brand = {
        brandId,
        presetKey: CUSTOM_API_PRESET_KEY,
        name: provider.name || customApiPreset.name,
        presets: [customApiPreset],
        providers: [],
        editableName: true,
      }
      byId.set(brandId, brand)
      order.push(brandId)
    }
    brand.providers.push(provider)
  }

  return order.map((id) => byId.get(id)!)
}

export function draftCustomBrand(): ProviderBrand {
  return { brandId: DRAFT_CUSTOM_BRAND_ID, presetKey: CUSTOM_API_PRESET_KEY, name: customApiPreset.name, presets: [customApiPreset], providers: [], editableName: true }
}

/** New-key draft that inherits the previous key's config as the starting point (clears identity + secret). */
export function draftFromProvider(prev: ApiProvider): ApiProvider {
  return { ...prev, id: '', key_name: '', api_key: '', is_active_claude: 0, is_active_codex: 0, created_at: '', updated_at: '' }
}

/** A key name unique within a platform: falls back to 'default' and suffixes ' 2', ' 3', … on collision. */
export function uniqueKeyName(base: string, existing: string[]): string {
  const name = base.trim() || 'default'
  if (!existing.includes(name)) return name
  let i = 2
  while (existing.includes(`${name} ${i}`)) i++
  return `${name} ${i}`
}

export function presetToAgentConfigs(preset: QuickPreset): string {
  const out: Record<string, AgentProviderConfig> = {}
  for (const [agent, cfg] of Object.entries(preset.agent_configs)) {
    if (!cfg) continue
    out[agent] = {
      base_url: cfg.base_url,
      extra_env: cfg.extra_env || '{}',
      model_env: JSON.stringify(cfg.model_env ?? {}),
      api_format: cfg.api_format ?? 'anthropic',
    }
  }
  return JSON.stringify(out)
}

export function draftProviderFromPreset(preset: QuickPreset): ApiProvider {
  return {
    id: '',
    name: preset.name === 'Custom API' ? '' : preset.name,
    key_name: '',
    provider_type: preset.provider_type,
    api_key: '',
    api_key_env: '',
    category: preset.category,
    supported_agents: JSON.stringify(preset.supported_agents),
    agent_configs: presetToAgentConfigs(preset),
    capabilities: '[]',
    is_active_claude: 0,
    is_active_codex: 0,
    sort_order: 0,
    notes: '',
    created_at: '',
    updated_at: '',
    base_url: '',
    extra_env: '',
    is_active: 0,
    agent_type: '',
    api_format: '',
  }
}
