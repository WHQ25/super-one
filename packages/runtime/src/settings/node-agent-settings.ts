/**
 * Persist node agent defaults under SUPERONE_NODE_HOME/config.json.
 *
 * Agent keys only (claude/codex defaults + experimental feature flags).
 * Electron-free; CLI and tests own the file path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  NodeAgentSettings,
  NodeAgentSettingsPatch,
  NodeClaudeAgentDefaults,
  NodeCodexAgentDefaults,
} from '@superone/shared/environment'

const CODEX_PRESETS = new Set(['', 'read-only', 'default', 'full-access'])
const SANDBOX_MODES = new Set(['', 'off', 'on', 'auto'])

export const DEFAULT_NODE_AGENT_SETTINGS: NodeAgentSettings = {
  claude: {
    defaultModel: '',
    defaultEffort: '',
    permissionMode: '',
    sandboxMode: '',
    disabledSkills: [],
  },
  codex: {
    defaultModel: '',
    defaultEffort: '',
    permissionPreset: '',
  },
  experimentalClaudeOpenAiChatEnabled: false,
}

/** File root shape: merge agent block into existing config.json without clobbering peers. */
export interface NodeConfigFile {
  agent?: NodeAgentSettings
  [key: string]: unknown
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
}

function normalizeClaude(raw: unknown): NodeClaudeAgentDefaults {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const sandboxMode = asString(r.sandboxMode ?? r.defaultSandboxMode, '')
  const permissionMode = asString(r.permissionMode ?? r.defaultPermissionMode, '')
  return {
    defaultModel: asString(r.defaultModel, ''),
    defaultEffort: asString(r.defaultEffort, ''),
    permissionMode,
    sandboxMode: SANDBOX_MODES.has(sandboxMode) ? sandboxMode : '',
    disabledSkills: asStringArray(r.disabledSkills, []),
  }
}

function normalizeCodex(raw: unknown): NodeCodexAgentDefaults {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const permissionPreset = asString(
    r.permissionPreset ?? r.defaultPermissionPreset,
    '',
  )
  return {
    defaultModel: asString(r.defaultModel, ''),
    defaultEffort: asString(r.defaultEffort ?? r.defaultReasoningEffort, ''),
    permissionPreset: CODEX_PRESETS.has(permissionPreset)
      ? (permissionPreset as NodeCodexAgentDefaults['permissionPreset'])
      : '',
  }
}

export function normalizeNodeAgentSettings(raw: unknown): NodeAgentSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  // Accept either nested under agent or top-level claude/codex (settings.get shape).
  const agent =
    r.agent && typeof r.agent === 'object'
      ? (r.agent as Record<string, unknown>)
      : r
  return {
    claude: normalizeClaude(agent.claude),
    codex: normalizeCodex(agent.codex),
    experimentalClaudeOpenAiChatEnabled: asBoolean(
      agent.experimentalClaudeOpenAiChatEnabled,
      false,
    ),
  }
}

export function mergeNodeAgentSettings(
  current: NodeAgentSettings,
  patch: NodeAgentSettingsPatch,
): NodeAgentSettings {
  const next: NodeAgentSettings = {
    claude: { ...current.claude },
    codex: { ...current.codex },
    experimentalClaudeOpenAiChatEnabled: current.experimentalClaudeOpenAiChatEnabled,
  }

  if (patch.claude) {
    if (typeof patch.claude.defaultModel === 'string') {
      next.claude.defaultModel = patch.claude.defaultModel
    }
    if (typeof patch.claude.defaultEffort === 'string') {
      next.claude.defaultEffort = patch.claude.defaultEffort
    }
    if (typeof patch.claude.permissionMode === 'string') {
      next.claude.permissionMode = patch.claude.permissionMode
    }
    if (typeof patch.claude.sandboxMode === 'string') {
      const m = patch.claude.sandboxMode
      next.claude.sandboxMode = SANDBOX_MODES.has(m) ? m : next.claude.sandboxMode
    }
    if (Array.isArray(patch.claude.disabledSkills)) {
      next.claude.disabledSkills = patch.claude.disabledSkills
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  if (patch.codex) {
    if (typeof patch.codex.defaultModel === 'string') {
      next.codex.defaultModel = patch.codex.defaultModel
    }
    if (typeof patch.codex.defaultEffort === 'string') {
      next.codex.defaultEffort = patch.codex.defaultEffort
    }
    if (typeof patch.codex.permissionPreset === 'string') {
      const p = patch.codex.permissionPreset
      if (CODEX_PRESETS.has(p)) {
        next.codex.permissionPreset = p as NodeCodexAgentDefaults['permissionPreset']
      }
    }
  }

  if (typeof patch.experimentalClaudeOpenAiChatEnabled === 'boolean') {
    next.experimentalClaudeOpenAiChatEnabled = patch.experimentalClaudeOpenAiChatEnabled
  }

  return normalizeNodeAgentSettings(next)
}

function readConfigFile(path: string): NodeConfigFile {
  if (!existsSync(path)) return {}
  try {
    const text = readFileSync(path, 'utf8')
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as NodeConfigFile
    }
  } catch {
    /* corrupt → start clean for agent block */
  }
  return {}
}

export function loadNodeAgentSettings(configPath: string): NodeAgentSettings {
  const file = readConfigFile(configPath)
  if (file.agent) return normalizeNodeAgentSettings(file.agent)
  // Also accept flat claude/codex at root for hand-edited files.
  if (
    file.claude
    || file.codex
    || typeof file.experimentalClaudeOpenAiChatEnabled === 'boolean'
  ) {
    return normalizeNodeAgentSettings(file)
  }
  return { ...DEFAULT_NODE_AGENT_SETTINGS, claude: { ...DEFAULT_NODE_AGENT_SETTINGS.claude, disabledSkills: [] }, codex: { ...DEFAULT_NODE_AGENT_SETTINGS.codex } }
}

export function saveNodeAgentSettings(
  configPath: string,
  settings: NodeAgentSettings,
): NodeAgentSettings {
  const normalized = normalizeNodeAgentSettings(settings)
  const file = readConfigFile(configPath)
  const next: NodeConfigFile = {
    ...file,
    agent: normalized,
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return normalized
}

export function patchNodeAgentSettings(
  configPath: string,
  patch: NodeAgentSettingsPatch,
): NodeAgentSettings {
  const current = loadNodeAgentSettings(configPath)
  const merged = mergeNodeAgentSettings(current, patch)
  return saveNodeAgentSettings(configPath, merged)
}

/**
 * Resolve harness defaults for a turn when the client omits fields.
 */
export function resolveAgentTurnDefaults(
  settings: NodeAgentSettings,
  harnessId: string,
): {
  model?: string
  effort?: string
  permissionMode?: string
  sandboxMode?: string
  permissionPreset?: string
  disabledSkills?: string[]
} {
  if (harnessId === 'codex') {
    const c = settings.codex
    return {
      ...(c.defaultModel.trim() ? { model: c.defaultModel.trim() } : {}),
      ...(c.defaultEffort.trim() ? { effort: c.defaultEffort.trim() } : {}),
      ...(c.permissionPreset.trim()
        ? { permissionPreset: c.permissionPreset.trim() }
        : {}),
    }
  }
  // claude + other harnesses: use claude defaults for model/effort/permission/sandbox/skills
  const c = settings.claude
  return {
    ...(c.defaultModel.trim() ? { model: c.defaultModel.trim() } : {}),
    ...(c.defaultEffort.trim() ? { effort: c.defaultEffort.trim() } : {}),
    ...(c.permissionMode.trim() ? { permissionMode: c.permissionMode.trim() } : {}),
    ...(c.sandboxMode.trim() ? { sandboxMode: c.sandboxMode.trim() } : {}),
    ...(c.disabledSkills.length > 0 ? { disabledSkills: [...c.disabledSkills] } : {}),
  }
}
