/**
 * Node agent defaults + sandbox probe RPC contracts.
 *
 * Electron-free. Agent-relevant prefs live on the node under SUPERONE_NODE_HOME
 * (config.json). Desktop remote settings UI reads/writes via these methods.
 */

import type {
  CodexPermissionPreset,
  SandboxCapability,
  SandboxMode,
  SandboxProbeResult,
  SandboxSupportLevel,
} from '../agent-types'

/** Per-harness agent defaults stored on the node. */
export interface NodeClaudeAgentDefaults {
  defaultModel: string
  defaultEffort: string
  /** Claude SDK permissionMode (default | acceptEdits | bypassPermissions | plan | …). */
  permissionMode: string
  /** off | on | auto; empty = unset (use platform default). */
  sandboxMode: string
  disabledSkills: string[]
  /**
   * AskUserQuestion option-preview format the node asks the model for
   * (SDK `toolConfig.askUserQuestion.previewFormat`): markdown | html.
   * Empty = unset (SDK default). Node-local rendering preference — the
   * controlling client does not push its own value down.
   */
  askUserQuestionPreviewFormat: string
}

export interface NodeCodexAgentDefaults {
  defaultModel: string
  defaultEffort: string
  permissionPreset: CodexPermissionPreset | ''
}

/**
 * Agent keys only — intentionally not full desktop AppSettings.
 * Wire shape matches settings.get / settings.patch.
 */
export interface NodeAgentSettings {
  claude: NodeClaudeAgentDefaults
  codex: NodeCodexAgentDefaults
  experimentalClaudeOpenAiChatEnabled: boolean
  /**
   * Owner-written note about this machine (what it is for, what it has), shown
   * to agents in `environment_list` as `descriptor.note`. Empty when unset.
   */
  note: string
  /**
   * Directory `git.clone` puts a repository in when the caller names none, as
   * when another machine launches an agent here for a repository this machine
   * lacks. Empty or absent means {@link DEFAULT_NODE_PROJECTS_DIR}.
   */
  projectsDir?: string
}

/** Default parent directory for clones a remote launch asks for (`~` is the node user's home). */
export const DEFAULT_NODE_PROJECTS_DIR = '~/SuperOne/Projects'

/** The directory `git.clone` uses when the caller names none. */
export function nodeProjectsDir(settings: Pick<NodeAgentSettings, 'projectsDir'>): string {
  return settings.projectsDir?.trim() || DEFAULT_NODE_PROJECTS_DIR
}

export type NodeAgentSettingsPatch = {
  claude?: Partial<NodeClaudeAgentDefaults>
  codex?: Partial<
    Omit<NodeCodexAgentDefaults, 'permissionPreset'> & {
      permissionPreset?: CodexPermissionPreset | ''
    }
  >
  experimentalClaudeOpenAiChatEnabled?: boolean
  note?: string
  projectsDir?: string
}

export interface SettingsGetRequest {
  /** Reserved for future scoping; currently ignored. */
  keys?: string[]
}

export interface SettingsGetResult {
  settings: NodeAgentSettings
}

export interface SettingsPatchRequest {
  patch: NodeAgentSettingsPatch
}

export interface SettingsPatchResult {
  settings: NodeAgentSettings
}

/**
 * sandbox.probe result: capability booleans + desktop-compatible probe fields.
 */
export interface SandboxProbeRpcResult {
  ok: boolean
  supportLevel: SandboxSupportLevel
  platform: string
  defaultMode: SandboxMode
  /** Linux: bubblewrap (bwrap) binary present. */
  bwrap: boolean
  /** Linux: socat binary present. */
  socat: boolean
  missing: string[]
  installHint?: string
  unsupportedReason?: string
  /** Desktop SandboxProbeResult-compatible summary. */
  probe: SandboxProbeResult
  capability: SandboxCapability
}

export type { SandboxMode, SandboxProbeResult, SandboxCapability, SandboxSupportLevel }
