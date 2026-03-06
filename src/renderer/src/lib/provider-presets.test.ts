import { describe, it, expect } from 'vitest'
import {
  PRESETS,
  CATEGORY_ORDER,
  getPresetsByCategory,
  resolveTemplateValues,
} from './provider-presets'
import type { ProviderCategory } from './provider-presets'

describe('resolveTemplateValues', () => {
  it('should replace template placeholders with values', () => {
    expect(resolveTemplateValues('https://api/${REGION}/endpoint', { REGION: 'us-east-1' }))
      .toBe('https://api/us-east-1/endpoint')
  })

  it('should replace missing keys with empty string', () => {
    expect(resolveTemplateValues('${MISSING}/path', {})).toBe('/path')
  })

  it('should handle multiple replacements', () => {
    const result = resolveTemplateValues('${A}-${B}-${A}', { A: 'x', B: 'y' })
    expect(result).toBe('x-y-x')
  })

  it('should return original string when no placeholders exist', () => {
    expect(resolveTemplateValues('no-placeholders', { A: 'x' })).toBe('no-placeholders')
  })
})

describe('getPresetsByCategory', () => {
  it('should group presets by category', () => {
    const grouped = getPresetsByCategory(PRESETS)
    expect(grouped.size).toBeGreaterThan(0)
    for (const [cat, items] of grouped) {
      expect(items.every((p) => p.category === cat)).toBe(true)
    }
  })

  it('should omit categories with no presets', () => {
    const grouped = getPresetsByCategory([])
    expect(grouped.size).toBe(0)
  })

  it('should follow CATEGORY_ORDER', () => {
    const grouped = getPresetsByCategory(PRESETS)
    const keys = [...grouped.keys()]
    const orderIndices = keys.map((k) => CATEGORY_ORDER.indexOf(k))
    for (let i = 1; i < orderIndices.length; i++) {
      expect(orderIndices[i]).toBeGreaterThan(orderIndices[i - 1])
    }
  })
})

describe('PRESETS', () => {
  it('should all have unique keys', () => {
    const keys = PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('should all have valid categories', () => {
    const validCategories: ProviderCategory[] = ['model_provider', 'cloud_platform', 'aggregator', 'proxy_service', 'custom']
    expect(PRESETS.every((p) => validCategories.includes(p.category))).toBe(true)
  })

  it('should have supported_agents matching agent_configs keys', () => {
    for (const preset of PRESETS) {
      for (const agent of preset.supported_agents) {
        expect(preset.agent_configs[agent]).toBeDefined()
      }
    }
  })

  it('should have bedrock preset with templateValues', () => {
    const bedrock = PRESETS.find((p) => p.key === 'bedrock')
    expect(bedrock).toBeDefined()
    expect(bedrock!.templateValues).toBeDefined()
    expect(bedrock!.templateValues!.AWS_REGION).toBeDefined()
    expect(bedrock!.templateValues!.AWS_ACCESS_KEY_ID).toBeDefined()
    expect(bedrock!.templateValues!.AWS_SECRET_ACCESS_KEY).toBeDefined()
  })

  it('should have kat-coder preset with ENDPOINT_ID templateValue', () => {
    const katCoder = PRESETS.find((p) => p.key === 'kat-coder')
    expect(katCoder).toBeDefined()
    expect(katCoder!.templateValues).toBeDefined()
    expect(katCoder!.templateValues!.ENDPOINT_ID).toBeDefined()
    expect(katCoder!.templateValues!.ENDPOINT_ID.placeholder).toBe('ep-xxx-xxx')
  })

  it('should have cross-agent providers with both claude and codex configs', () => {
    const openrouter = PRESETS.find((p) => p.key === 'openrouter')
    expect(openrouter).toBeDefined()
    expect(openrouter!.supported_agents).toContain('claude')
    expect(openrouter!.supported_agents).toContain('codex')
    expect(openrouter!.agent_configs.claude).toBeDefined()
    expect(openrouter!.agent_configs.codex).toBeDefined()
  })

  it('should have dmxapi and packycode as proxy_service with both agents', () => {
    const dmxapi = PRESETS.find((p) => p.key === 'dmxapi')
    const packycode = PRESETS.find((p) => p.key === 'packycode')
    expect(dmxapi!.category).toBe('proxy_service')
    expect(packycode!.category).toBe('proxy_service')
    expect(dmxapi!.supported_agents).toEqual(['claude', 'codex'])
    expect(packycode!.supported_agents).toEqual(['claude', 'codex'])
  })

  it('should have custom-api supporting both agents', () => {
    const custom = PRESETS.find((p) => p.key === 'custom-api')
    expect(custom!.supported_agents).toEqual(['claude', 'codex'])
    expect(custom!.agent_configs.claude).toBeDefined()
    expect(custom!.agent_configs.codex).toBeDefined()
  })
})
