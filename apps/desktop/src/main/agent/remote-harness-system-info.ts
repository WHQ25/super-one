import type {
  AppSettings,
  DeepseekPresetRoster,
  HarnessId,
  HarnessResourcesMap,
  Locale,
  ModelOption,
  RemoteActiveProvider,
  RemoteProviderOption,
  RemoteSystemInfo,
  SandboxMode,
  SandboxSupportLevel,
} from '@superone/shared/agent-types'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { sessionDefaultsForHarness } from '@superone/shared/harness/session-defaults'
import {
  coerceSandboxModeForHarness,
  harnessSandboxModes,
} from '@superone/shared/harness/harness-sandbox'
import { BASE_SESSION_PROVIDERS } from '@superone/shared/session-provider-definitions'
import { deriveSessionCatalog } from '../acp/acp-config'
import { acpModeCatalog, deepseekModeCatalog, openCodeAgentCatalog } from './remote-selector-catalog'

type ResourceReader = <H extends HarnessId>(harnessId: H) => HarnessResourcesMap[H] | null

export interface RemoteHarnessSystemInfoDependencies {
  settings: AppSettings
  /**
   * Locale already resolved by main (`settings.locale` or the system fallback).
   * Passed in rather than read here so this module stays free of electron.
   */
  currentLocale: Locale
  getCachedResources: ResourceReader
  fetchClaudeModels: (projectPath: string) => Promise<ModelOption[]>
  listCodexModels?: (projectPath: string) => Promise<ModelOption[]>
  codexAccount?: (projectPath: string) => unknown
  activeProvider: (harnessId: 'claude' | 'codex') => RemoteActiveProvider | null
  /** Credentials/accounts the harness can run on, already shaped for the client. */
  providerCatalog?: (harnessId: HarnessId) => {
    providers: RemoteProviderOption[]
    selectedProviderId: string | null
  }
  /** DeepSeek preset roster. Project-level, so it names no live session. */
  deepseekPresets?: () => Promise<DeepseekPresetRoster | null>
  /**
   * Sandbox a new session would start in, already coerced to what this platform
   * can actually provide. Passed in so this module stays free of the electron
   * settings/capability probes behind it.
   */
  defaultSandboxMode?: () => SandboxMode | undefined
  /**
   * Whether this host can sandbox at all. Separate from `defaultSandboxMode`,
   * which coerces to `off` on a platform without one — a client cannot tell
   * "the user chose off" from "this host has no sandbox" out of that alone.
   */
  sandboxSupport?: () => SandboxSupportLevel
}

const CODEX_PERMISSION_PRESETS = ['read-only', 'default', 'auto-review', 'full-access'] as const

function present(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function preferredModel(models: ModelOption[], requested?: string | null): ModelOption | undefined {
  return models.find((model) => model.id === requested)
    ?? models.find((model) => model.isDefault)
    ?? models[0]
}

function preferredEffort(model: ModelOption | undefined, requested?: string | null): string | null {
  const values: string[] = model?.supportedReasoningEfforts?.map((option) => option.value)
    ?? model?.supportedEffortLevels
    ?? []
  if (requested && (values.length === 0 || values.includes(requested))) return requested
  if (model?.defaultReasoningEffort && values.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }
  return values.includes('medium') ? 'medium' : values[0] ?? null
}

function defaultInfo(
  harnessId: HarnessId,
  preferences: AppSettings['agentPreference'],
  models: ModelOption[],
  permissionModes: readonly string[],
  requestedModel?: string | null,
): RemoteSystemInfo {
  const model = preferredModel(models, requestedModel)
  return {
    models,
    slashCommands: [],
    permissionModes: [...permissionModes],
    defaults: {
      model: model?.id ?? null,
      effort: preferredEffort(model),
      permissionMode: sessionDefaultsForHarness(preferences, harnessId).permissionMode,
    },
  }
}

/**
 * A remote shell has no settings store of its own, so the brand hue, locale and
 * sandbox capability of this host travel with the harness catalog rather than as
 * a second round trip. They are appended once, around the per-harness switch, so
 * no branch can forget them.
 */
export async function buildRemoteHarnessSystemInfo(
  projectPath: string,
  harnessId: HarnessId,
  deps: RemoteHarnessSystemInfoDependencies,
): Promise<RemoteSystemInfo> {
  const info = await harnessSystemInfo(projectPath, harnessId, deps)
  return {
    ...info,
    brandHue: deps.settings.agentPreference[harnessId]?.brandHue ?? null,
    locale: deps.currentLocale,
    sandboxSupport: deps.sandboxSupport?.() ?? 'always',
  }
}

async function harnessSystemInfo(
  projectPath: string,
  harnessId: HarnessId,
  deps: RemoteHarnessSystemInfoDependencies,
): Promise<RemoteSystemInfo> {
  const preferences = deps.settings.agentPreference

  switch (harnessId) {
    case 'claude': {
      const cached = deps.getCachedResources('claude')
      const models = cached?.models?.length
        ? cached.models
        : await deps.fetchClaudeModels(projectPath)
      const model = preferredModel(models, preferences.claude.defaultModel)
      return {
        models,
        userSlashCommands: (cached?.slashCommands ?? []).filter((command) => !command.terminalBound),
        account: cached?.account ?? null,
        permissionModes: [...HARNESS_LAUNCH_OPTIONS.claude.permissionModes],
        sandboxModes: harnessSandboxModes('claude'),
        activeProvider: deps.activeProvider('claude'),
        ...deps.providerCatalog?.('claude'),
        defaults: {
          model: present(preferences.claude.defaultModel) ?? model?.id ?? null,
          effort: preferredEffort(model, preferences.claude.defaultEffort),
          permissionMode: sessionDefaultsForHarness(preferences, 'claude').permissionMode,
          sandboxMode: deps.defaultSandboxMode?.() ?? null,
        },
      }
    }
    case 'codex': {
      const cached = deps.getCachedResources('codex')
      const models = deps.listCodexModels
        ? await deps.listCodexModels(projectPath)
        : cached?.models ?? []
      const model = preferredModel(models, preferences.codex.defaultModel)
      const permissionPreset = present(preferences.codex.defaultPermissionPreset)
      const effort = preferredEffort(model, preferences.codex.defaultReasoningEffort)
      return {
        models,
        slashCommands: [
          { name: 'reset', description: 'Reset Codex thread', argumentHint: '', isSkill: false },
          { name: 'review', description: 'Review code changes', argumentHint: '', isSkill: false },
          { name: 'compact', description: 'Compact thread context', argumentHint: '', isSkill: false },
          ...(cached?.prompts ?? []),
        ],
        account: deps.codexAccount?.(projectPath) ?? null,
        permissionModes: [...HARNESS_LAUNCH_OPTIONS.codex.permissionModes],
        permissionPresets: [...CODEX_PERMISSION_PRESETS],
        activeProvider: deps.activeProvider('codex'),
        ...deps.providerCatalog?.('codex'),
        defaults: {
          model: present(preferences.codex.defaultModel) ?? model?.id ?? null,
          effort,
          permissionMode: sessionDefaultsForHarness(preferences, 'codex').permissionMode,
          // Same conjunction the desktop's own launch profiles use: the
          // preference only means anything on a model that offers the tier.
          fastMode: preferences.codex.defaultFastMode && !!findCodexFastServiceTier(model),
          reasoningEffort: effort,
          permissionPreset,
        },
      }
    }
    case 'acp': {
      const cached = deps.getCachedResources('acp')
      const fallbackAgentId = BASE_SESSION_PROVIDERS.acp.config.agentId
      const acpAgentId = present(preferences.acp.selectedAgentId)
        ?? present(cached?.selectedAgentId)
        ?? (typeof fallbackAgentId === 'string' ? fallbackAgentId : null)
      const catalog = acpAgentId ? cached?.configByAgentId?.[acpAgentId] : undefined
      const sessionCatalog = catalog ? deriveSessionCatalog(catalog) : null
      const models = sessionCatalog?.models ?? []
      const model = preferredModel(models, sessionCatalog?.selectedModelId)
      // Only Grok-style extraModes are reasoning effort; real `configOptions`
      // modes are a session mode the backend applies through set_session_mode.
      const { efforts, modes, selectedModeId } = acpModeCatalog(sessionCatalog && {
        modes: sessionCatalog.modes,
        modeConfigId: sessionCatalog.modeConfigId,
        selectedModeId: sessionCatalog.selectedModeId,
      })
      const selectedEffort = present(sessionCatalog?.selectedModeId)
      return {
        models,
        efforts,
        ...(modes.length ? { modes, selectedModeId, modeLabel: 'Mode' } : {}),
        slashCommands: sessionCatalog?.slashCommands ?? [],
        permissionModes: [...HARNESS_LAUNCH_OPTIONS.acp.permissionModes],
        acpAgentId,
        defaults: {
          model: model?.id ?? null,
          effort: (selectedEffort && efforts.some((option) => option.value === selectedEffort)
            ? selectedEffort
            : efforts.find((option) => option.value === 'medium')?.value ?? efforts[0]?.value)
            ?? null,
          permissionMode: sessionDefaultsForHarness(preferences, 'acp').permissionMode,
        },
      }
    }
    case 'opencode': {
      const cached = deps.getCachedResources('opencode')
      return {
        ...defaultInfo(
          'opencode',
          preferences,
          cached?.models ?? [],
          HARNESS_LAUNCH_OPTIONS.opencode.permissionModes,
        ),
        ...openCodeAgentCatalog(cached),
        slashCommands: cached?.commands ?? [],
      }
    }
    case 'cursor': {
      const cached = deps.getCachedResources('cursor')
      const disabled = new Set(cached?.disabledModelIds ?? [])
      const info = defaultInfo(
        'cursor',
        preferences,
        (cached?.models ?? []).filter((model) => !disabled.has(model.id)),
        HARNESS_LAUNCH_OPTIONS.cursor.permissionModes,
      )
      // Cursor drives a real sandbox toggle, so it needs the same two facts
      // Claude gets. It has no `auto`, hence the coercion.
      const sandboxMode = deps.defaultSandboxMode?.()
      return {
        ...info,
        sandboxModes: harnessSandboxModes('cursor'),
        defaults: {
          ...info.defaults,
          sandboxMode: sandboxMode ? coerceSandboxModeForHarness('cursor', sandboxMode) : null,
        },
        account: cached?.user ?? null,
      }
    }
    case 'dsh': {
      const info = defaultInfo(
        'dsh',
        preferences,
        deps.getCachedResources('dsh')?.models ?? [],
        HARNESS_LAUNCH_OPTIONS.dsh.permissionModes,
      )
      const { modes, selectedModeId, modesLocked } = deepseekModeCatalog(
        (await deps.deepseekPresets?.()) ?? null,
      )
      if (modes.length === 0) return info
      return {
        ...info,
        modes,
        selectedModeId,
        modeLabel: 'Preset',
        ...(modesLocked ? { modesLocked } : {}),
      }
    }
    default: {
      const exhaustive: never = harnessId
      return exhaustive
    }
  }
}
