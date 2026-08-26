import type { ConfigFieldType } from '@superone/shared/agent-types'
import { PROTOCOL_FAMILY, type EndpointModel, type PlanCapabilities, type ProtocolFamily, type WireProtocol } from '@superone/shared/platform-registry'
import { getMermaidThemeOption } from '@/components/chat/mermaid-themes'
import { mermaidThemeSchemeForKey } from '@/components/settings/MermaidThemePicker'
import { getTerminalPalette } from '@/components/coding/terminal-palettes'
import { terminalPaletteSchemeForKey } from '@/components/settings/TerminalPalettePicker'
import {
  formatHarnessPreferenceLabel,
  isHarnessPreferenceFieldKey,
} from '@/components/settings/HarnessPreferencePicker'

/**
 * Human-readable rendering of config values. Structured provider fields (env maps, model-mapping slots,
 * enabled models, wire capabilities) reach the UI as objects; printing them as JSON is what made the
 * confirmation dialog unreadable, so every type gets a one-line summary and a change gets a diff that
 * names only what actually moved.
 */

const FAMILY_LABEL: Record<ProtocolFamily, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  volcengine: 'Volcengine',
  newapi: 'New API',
  google: 'Google',
}

function asMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asModels(value: unknown): EndpointModel[] {
  return Array.isArray(value) ? (value as EndpointModel[]) : []
}

function slotText(value: unknown): string {
  const slot = asMap(value)
  const id = typeof slot.id === 'string' ? slot.id : ''
  const name = typeof slot.name === 'string' ? slot.name : ''
  return id || name || String(value)
}

/** Protocols grouped under their vendor, e.g. "OpenAI · chat, images / 火山引擎 · ark-video". */
function capabilitiesText(value: unknown): string {
  const caps = value as PlanCapabilities | undefined
  if (!caps?.protocols?.length) return ''
  const byFamily = new Map<ProtocolFamily, WireProtocol[]>()
  for (const protocol of caps.protocols) {
    const family = PROTOCOL_FAMILY[protocol]
    byFamily.set(family, [...(byFamily.get(family) ?? []), protocol])
  }
  return [...byFamily]
    .map(([family, protocols]) => `${FAMILY_LABEL[family]} · ${protocols.join(', ')}`)
    .join(' / ')
}

/** One-line rendering of a single value, used for the "current value" line and for create proposals. */
export function formatConfigFieldValue(type: ConfigFieldType, value: unknown, emptyLabel: string): string {
  if (value === null || value === undefined || value === '') return emptyLabel
  switch (type) {
    case 'boolean':
      return value ? 'on' : 'off'
    case 'env': {
      const entries = Object.entries(asMap(value))
      return entries.length === 0 ? emptyLabel : entries.map(([k, v]) => `${k}=${String(v)}`).join(', ')
    }
    case 'model-mapping': {
      const entries = Object.entries(asMap(value))
      return entries.length === 0 ? emptyLabel : entries.map(([slot, v]) => `${slot}: ${slotText(v)}`).join(', ')
    }
    case 'models': {
      const models = asModels(value)
      return models.length === 0 ? emptyLabel : models.map((m) => m.name || m.id).join(', ')
    }
    case 'capabilities': {
      const text = capabilitiesText(value)
      return text || emptyLabel
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

/**
 * Like {@link formatConfigFieldValue}, but maps known appearance enum ids
 * (mermaid themes, terminal palettes) to the same labels the pickers show.
 */
export function formatSettingsFieldDisplay(
  key: string,
  type: ConfigFieldType,
  value: unknown,
  emptyLabel: string,
): string {
  // Harness Auto is null — still show a label, not the generic empty string.
  if (isHarnessPreferenceFieldKey(key)) {
    return formatHarnessPreferenceLabel(value, 'Auto', {
      claude: 'Claude Code',
      codex: 'Codex',
      opencode: 'OpenCode',
      deepseek: 'DeepSeek',
    })
  }

  if (value === null || value === undefined || value === '') return emptyLabel

  const mermaidScheme = mermaidThemeSchemeForKey(key)
  if (mermaidScheme) {
    return getMermaidThemeOption(mermaidScheme, String(value)).name
  }

  const terminalScheme = terminalPaletteSchemeForKey(key)
  if (terminalScheme) {
    return getTerminalPalette(String(value), terminalScheme).name
  }

  return formatConfigFieldValue(type, value, emptyLabel)
}

function mapDiff(prev: Record<string, unknown>, next: Record<string, unknown>, render: (v: unknown) => string): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(next)) {
    if (!(key in prev)) out.push(`+${key} ${render(value)}`)
    else if (render(prev[key]) !== render(value)) out.push(`${key} ${render(prev[key])} → ${render(value)}`)
  }
  for (const key of Object.keys(prev)) if (!(key in next)) out.push(`−${key}`)
  return out
}

function listDiff(prev: string[], next: string[]): string[] {
  const added = next.filter((v) => !prev.includes(v)).map((v) => `+${v}`)
  const removed = prev.filter((v) => !next.includes(v)).map((v) => `−${v}`)
  return [...added, ...removed]
}

/**
 * A change summary that names only what moved. Returns null when the type has no meaningful diff
 * (scalars), so the caller falls back to the plain "old → new" pair.
 */
export function diffConfigFieldValue(type: ConfigFieldType, oldValue: unknown, newValue: unknown): string | null {
  switch (type) {
    case 'env':
      return mapDiff(asMap(oldValue), asMap(newValue), (v) => String(v)).join(', ') || null
    case 'model-mapping':
      return mapDiff(asMap(oldValue), asMap(newValue), slotText).join(', ') || null
    case 'models':
      return listDiff(asModels(oldValue).map((m) => m.id), asModels(newValue).map((m) => m.id)).join(', ') || null
    case 'capabilities': {
      const prev = capabilitiesParts(oldValue)
      const next = capabilitiesParts(newValue)
      return listDiff(prev, next).join(', ') || null
    }
    default:
      return null
  }
}

/** One part per protocol, so a diff names exactly the wires that were added or removed. */
function capabilitiesParts(value: unknown): string[] {
  const caps = value as PlanCapabilities | undefined
  if (!caps?.protocols?.length) return []
  return caps.protocols.map((protocol) => `${FAMILY_LABEL[PROTOCOL_FAMILY[protocol]]}·${protocol}`)
}
