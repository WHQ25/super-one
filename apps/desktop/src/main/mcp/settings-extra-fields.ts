import { isAbsolute } from 'node:path'
import type { AppSettings, DshSubagentModelSelection } from '@superone/shared/agent-types'
import { NOTIFICATION_KINDS } from '@superone/shared/notifications'
import type { SettingsFieldDef } from './settings-registry'

export const GENERAL_EXTRA_FIELDS: SettingsFieldDef[] = [
  {
    key: 'powerMode', label: 'Power Mode', type: 'enum',
    enumValues: ['system', 'prevent-idle-sleep', 'lid-closed-on-ac'],
    note: 'Closed-lid operation may require OS administrator approval. Keep the computer ventilated and connected to AC power.',
    read: (s) => s.powerMode,
    toPatch: (v) => ({ powerMode: v as AppSettings['powerMode'] }),
  },
  {
    key: 'experimentalClaudeOpenAiChatEnabled', label: 'Claude OpenAI Chat', type: 'boolean',
    read: (s) => s.experimentalClaudeOpenAiChatEnabled,
    toPatch: (v) => ({ experimentalClaudeOpenAiChatEnabled: v as boolean }),
  },
  {
    key: 'notificationsEnabled', label: 'Notifications', type: 'boolean',
    read: (s) => s.notifications.enabled,
    toPatch: (v) => ({ notifications: { enabled: v as boolean } }),
  },
  ...NOTIFICATION_KINDS.map((kind): SettingsFieldDef => ({
    key: `notification${kind[0].toUpperCase()}${kind.slice(1)}`,
    label: `Notifications: ${kind}`, type: 'boolean',
    read: (s) => s.notifications.kinds[kind],
    toPatch: (v) => ({ notifications: { kinds: { [kind]: v as boolean } } }),
  })),
]

export const THEME_MODE_FIELD: SettingsFieldDef = {
  key: 'themeMode', label: 'Theme Mode', type: 'enum', enumValues: ['system', 'light', 'dark'],
  read: (s) => s.themeMode, toPatch: (v) => ({ themeMode: v as AppSettings['themeMode'] }),
}

export const CLAUDE_EXTRA_FIELDS: SettingsFieldDef[] = [
  {
    key: 'claudeDrawModInterfaces', label: 'Draw Mod Interfaces', type: 'boolean',
    read: (s) => s.agentPreference.claude.drawModInterfaces,
    toPatch: (v) => ({ agentPreference: { claude: { drawModInterfaces: v as boolean } } }),
  },
  {
    key: 'claudeModDevFolders', label: 'Mod Development Folders', type: 'json',
    note: 'An array of absolute directory paths. Replaces the list; [] clears it.',
    read: (s) => s.agentPreference.claude.modDevFolders,
    parse: (v) => {
      if (!Array.isArray(v) || v.some((path) => typeof path !== 'string' || !isAbsolute(path))) {
        throw new Error('Expected an array of absolute directory paths')
      }
      return [...new Set(v as string[])]
    },
    toPatch: (v) => ({ agentPreference: { claude: { modDevFolders: v as string[] } } }),
  },
]

export const DSH_SUBAGENT_FIELD: SettingsFieldDef = {
  key: 'dshSubagentModelSelection', label: 'Subagent Model Selection', type: 'json',
  note: '{ enabled: boolean, allowedModels: [{ provider: string, model: string }] }. Replaces the preference.',
  read: (s) => ({ ...s.dshSubagentModelSelection }),
  parse: (v) => {
    const selection = v as DshSubagentModelSelection | null
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)
      || typeof selection.enabled !== 'boolean' || !Array.isArray(selection.allowedModels)
      || Object.keys(selection).some((key) => key !== 'enabled' && key !== 'allowedModels')
      || selection.allowedModels.some((entry) => !entry || typeof entry.provider !== 'string' || !entry.provider.trim()
        || typeof entry.model !== 'string' || !entry.model.trim()
        || Object.keys(entry).some((key) => key !== 'provider' && key !== 'model'))) {
      throw new Error('Expected { enabled: boolean, allowedModels: [{ provider, model }] }')
    }
    return { enabled: selection.enabled, allowedModels: selection.allowedModels.map(({ provider, model }) => ({ provider: provider.trim(), model: model.trim() })) }
  },
  toPatch: (v) => ({ dshSubagentModelSelection: v as unknown as DshSubagentModelSelection }),
}
