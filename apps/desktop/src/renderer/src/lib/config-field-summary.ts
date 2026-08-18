import type { ConfigFieldType } from '@superone/shared/agent-types'
import { FAMILY_TASKS, type CapabilityTask, type EndpointModel, type PlanCapabilities, type ProtocolFamily } from '@superone/shared/platform-registry'
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
  newapi: 'NewAPI',
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

function capabilitiesText(value: unknown): string {
  const caps = value as PlanCapabilities | undefined
  if (!caps?.families?.length) return ''
  return caps.families
    .map((family) => {
      const tasks = caps.tasks?.[family] ?? FAMILY_TASKS[family]
      const extras = caps.extras?.[family] ?? []
      const parts = [...tasks, ...extras]
      return parts.length > 0 ? `${FAMILY_LABEL[family]} · ${parts.join(', ')}` : FAMILY_LABEL[family]
    })
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

function capabilitiesParts(value: unknown): string[] {
  const caps = value as PlanCapabilities | undefined
  if (!caps?.families?.length) return []
  return caps.families.flatMap((family) => {
    const tasks: (CapabilityTask | string)[] = caps.tasks?.[family] ?? FAMILY_TASKS[family]
    return [...tasks, ...(caps.extras?.[family] ?? [])].map((part) => `${FAMILY_LABEL[family]}·${part}`)
  })
}
