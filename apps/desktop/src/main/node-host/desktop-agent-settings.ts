import type { AppSettings } from '@superone/shared/agent-types'
import type { NodeAgentSettings } from '@superone/shared/environment'
import { normalizeNodeAgentSettings } from '@superone/runtime/settings'

/**
 * This desktop's agent defaults in the node settings shape, as `settings.get`
 * reports them to its clients. A clone without a parent goes where the
 * window's clone dialog defaults for this machine.
 */
export function desktopAgentSettings(
  settings: Pick<AppSettings, 'agentPreference' | 'experimentalClaudeOpenAiChatEnabled' | 'experimentalAgentProfilesEnabled' | 'defaultClonePaths' | 'sessionContinuationHint'>,
): NodeAgentSettings {
  const { claude, codex } = settings.agentPreference
  const agent = normalizeNodeAgentSettings({
    claude: {
      defaultModel: claude.defaultModel,
      defaultEffort: claude.defaultEffort,
      permissionMode: claude.defaultPermissionMode,
      sandboxMode: claude.defaultSandboxMode,
      disabledSkills: claude.disabledSkills,
      askUserQuestionPreviewFormat: claude.askUserQuestionPreviewFormat,
    },
    codex: {
      defaultModel: codex.defaultModel,
      defaultEffort: codex.defaultReasoningEffort,
      permissionPreset: codex.defaultPermissionPreset,
    },
    experimentalClaudeOpenAiChatEnabled: settings.experimentalClaudeOpenAiChatEnabled,
    experimentalAgentProfilesEnabled: settings.experimentalAgentProfilesEnabled,
    projectsDir: settings.defaultClonePaths.local ?? '',
  })
  // Not an agent default: the phone's continuation hint follows this desktop's.
  return { ...agent, sessionContinuationHint: settings.sessionContinuationHint }
}
