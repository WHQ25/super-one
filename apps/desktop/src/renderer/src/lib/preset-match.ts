import { PRESETS, type QuickPreset } from './provider-presets'
import type { AgentProviderConfig, ApiProvider } from '@superone/shared/agent-types'

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '').replace(/\$\{[^}]+\}/g, '').trim()
}

function urlMatches(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.startsWith(b + '/') || b.startsWith(a + '/')
}

export function resolvePresetKey(provider: ApiProvider): string | null {
  let configs: Record<string, AgentProviderConfig> = {}
  try { configs = JSON.parse(provider.agent_configs || '{}') } catch { return null }

  const claudeUrl = normalizeUrl(configs.claude?.base_url ?? '')
  const codexUrl = normalizeUrl(configs.codex?.base_url ?? '')
  const name = (provider.name || '').toLowerCase()

  const matched: Array<{ preset: QuickPreset; score: number }> = []
  for (const preset of PRESETS) {
    let bestForPreset = 0
    for (const cfg of Object.values(preset.agent_configs)) {
      const presetUrl = normalizeUrl(cfg?.base_url ?? '')
      if (!presetUrl) continue
      if (urlMatches(claudeUrl, presetUrl) || urlMatches(codexUrl, presetUrl)) {
        if (presetUrl.length > bestForPreset) bestForPreset = presetUrl.length
      }
    }
    if (bestForPreset > 0) matched.push({ preset, score: bestForPreset })
  }

  if (matched.length > 0) {
    const maxScore = Math.max(...matched.map((m) => m.score))
    const top = matched.filter((m) => m.score === maxScore)
    if (top.length === 1) return top[0].preset.key
    const byName = top.find((m) => {
      const presetNameLower = m.preset.name.toLowerCase()
      return name.includes(presetNameLower) || name.includes(m.preset.key.split('-')[0])
    })
    return (byName ?? top[0]).preset.key
  }

  if (provider.provider_type === 'bedrock') return 'bedrock'
  if (provider.provider_type === 'vertex') return 'vertex'
  if (provider.provider_type === 'anthropic') return 'anthropic-official'
  if (provider.provider_type === 'openrouter') return 'openrouter'

  return null
}

export function getPresetByKey(key: string): QuickPreset | undefined {
  return PRESETS.find((p) => p.key === key)
}
