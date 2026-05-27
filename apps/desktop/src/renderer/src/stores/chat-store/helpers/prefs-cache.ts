import type {
  CodexReasoningEffort,
  EffortLevel,
  PermissionMode,
  SandboxInfo,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'

interface DefaultPrefsCache {
  permissionMode: PermissionMode | null
  sandboxMode: SandboxMode | null
  claudeSelection: { modelId: string; effort?: EffortLevel } | null
  codexSelection: { modelId: string; reasoningEffort?: CodexReasoningEffort } | null
}

export const defaultPrefsCache: DefaultPrefsCache = {
  permissionMode: null,
  sandboxMode: null,
  claudeSelection: null,
  codexSelection: null,
}

export function toCodexReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    default:
      return undefined
  }
}

export function toEffortLevel(value: unknown): EffortLevel | undefined {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value
    default:
      return undefined
  }
}

export function resolveDefaultSandboxMode(stored: SandboxMode | null): SandboxMode | null {
  const capability = useAppStore.getState().sandboxCapability
  if (capability?.supportLevel === 'unsupported') return 'off'
  if (stored) return stored
  return capability?.defaultMode ?? null
}

export async function _loadDefaultSessionPrefs(): Promise<void> {
  try {
    const appSettings = await window.app.getAppSettings()
    const claude = appSettings.agentPreference?.claude
    defaultPrefsCache.permissionMode = (claude?.defaultPermissionMode as PermissionMode) || 'default'
    defaultPrefsCache.sandboxMode = resolveDefaultSandboxMode((claude?.defaultSandboxMode as SandboxMode) || null)
    defaultPrefsCache.claudeSelection = {
      modelId: typeof claude?.defaultModel === 'string' ? claude.defaultModel : '',
      effort: toEffortLevel(claude?.defaultEffort),
    }
    defaultPrefsCache.codexSelection = {
      modelId: typeof appSettings.agentPreference?.codex?.defaultModel === 'string' ? appSettings.agentPreference.codex.defaultModel : '',
      reasoningEffort: toCodexReasoningEffort(appSettings.agentPreference?.codex?.defaultReasoningEffort),
    }
  } catch {
    defaultPrefsCache.permissionMode = 'default'
    defaultPrefsCache.sandboxMode = null
    defaultPrefsCache.claudeSelection = { modelId: '', effort: undefined }
    defaultPrefsCache.codexSelection = { modelId: '', reasoningEffort: undefined }
  }
}

export async function _getDefaultPermissionMode(): Promise<PermissionMode> {
  if (defaultPrefsCache.permissionMode === null) await _loadDefaultSessionPrefs()
  return defaultPrefsCache.permissionMode ?? 'default'
}

export function sandboxModeToInfo(mode: SandboxMode): SandboxInfo {
  return { enabled: mode !== 'off', autoAllowBash: mode === 'auto' }
}

export function _clearDefaultPrefsCache(): void {
  defaultPrefsCache.permissionMode = null
  defaultPrefsCache.sandboxMode = null
  defaultPrefsCache.claudeSelection = null
  defaultPrefsCache.codexSelection = null
}

// Eager load on module init — same side-effect as the original index.ts.
void _loadDefaultSessionPrefs()
