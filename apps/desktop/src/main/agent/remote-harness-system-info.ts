import type {
  AppSettings,
  DeepseekPresetRoster,
  HarnessId,
  HarnessResourcesMap,
  ModelOption,
  RemoteActiveProvider,
  RemoteProviderOption,
  RemoteSystemInfo,
} from '@superone/shared/agent-types'
import { BASE_SESSION_PROVIDERS } from '@superone/shared/session-provider-definitions'
import { deriveSessionCatalog } from '../acp/acp-config'
import { acpModeCatalog, deepseekModeCatalog, openCodeAgentCatalog } from './remote-selector-catalog'

type ResourceReader = <H extends HarnessId>(harnessId: H) => HarnessResourcesMap[H] | null

export interface RemoteHarnessSystemInfoDependencies {
  settings: AppSettings
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
}

export const REMOTE_HARNESS_PERMISSION_MODES = {
  claude: ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'],
  // Codex's read-only preset has no shared PermissionMode spelling.
  codex: ['default', 'auto', 'bypassPermissions'],
  acp: ['default', 'plan', 'auto', 'bypassPermissions'],
  opencode: ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'],
  cursor: ['agent', 'plan', 'bypassPermissions'],
  dsh: ['plan', 'default', 'bypassPermissions'],
} as const satisfies Record<HarnessId, readonly string[]>

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

function codexPermissionMode(preset: string | null): string | null {
  if (preset === 'auto-review') return 'auto'
  if (preset === 'full-access') return 'bypassPermissions'
  if (preset === 'default') return 'default'
  return null
}

function defaultInfo(
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
      permissionMode: permissionModes[0] ?? null,
    },
  }
}

export async function buildRemoteHarnessSystemInfo(
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
        permissionModes: [...REMOTE_HARNESS_PERMISSION_MODES.claude],
        sandboxModes: ['off', 'on', 'auto'],
        activeProvider: deps.activeProvider('claude'),
        ...deps.providerCatalog?.('claude'),
        defaults: {
          model: present(preferences.claude.defaultModel) ?? model?.id ?? null,
          effort: preferredEffort(model, preferences.claude.defaultEffort),
          permissionMode: present(preferences.claude.defaultPermissionMode),
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
        permissionModes: [...REMOTE_HARNESS_PERMISSION_MODES.codex],
        permissionPresets: [...CODEX_PERMISSION_PRESETS],
        activeProvider: deps.activeProvider('codex'),
        ...deps.providerCatalog?.('codex'),
        defaults: {
          model: present(preferences.codex.defaultModel) ?? model?.id ?? null,
          effort,
          permissionMode: codexPermissionMode(permissionPreset),
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
        permissionModes: [...REMOTE_HARNESS_PERMISSION_MODES.acp],
        acpAgentId,
        defaults: {
          model: model?.id ?? null,
          effort: (selectedEffort && efforts.some((option) => option.value === selectedEffort)
            ? selectedEffort
            : efforts.find((option) => option.value === 'medium')?.value ?? efforts[0]?.value)
            ?? null,
          permissionMode: 'default',
        },
      }
    }
    case 'opencode': {
      const cached = deps.getCachedResources('opencode')
      return {
        ...defaultInfo(cached?.models ?? [], REMOTE_HARNESS_PERMISSION_MODES.opencode),
        ...openCodeAgentCatalog(cached),
        slashCommands: cached?.commands ?? [],
      }
    }
    case 'cursor': {
      const cached = deps.getCachedResources('cursor')
      const disabled = new Set(cached?.disabledModelIds ?? [])
      const info = defaultInfo(
        (cached?.models ?? []).filter((model) => !disabled.has(model.id)),
        REMOTE_HARNESS_PERMISSION_MODES.cursor,
      )
      return { ...info, account: cached?.user ?? null }
    }
    case 'dsh': {
      const info = defaultInfo(
        deps.getCachedResources('dsh')?.models ?? [],
        REMOTE_HARNESS_PERMISSION_MODES.dsh,
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
