import type { ComponentType } from 'react'
import { Blocks, Bot, Cloud, Cpu, KeyRound, Palette, Puzzle, Server, Webhook } from 'lucide-react'
import type { SettingsProvider } from '@superone/shared/agent-types'
import type { HarnessConfigSection } from '@/stores/app'

export const CONFIG_TAB_META: Record<
  HarnessConfigSection,
  { labelKey: string; icon: ComponentType<{ className?: string }> }
> = {
  preferences: { labelKey: 'settings.layout.tabs.preferences', icon: Palette },
  account: { labelKey: 'settings.layout.tabs.account', icon: KeyRound },
  agents: { labelKey: 'settings.layout.tabs.agents', icon: Bot },
  skills: { labelKey: 'settings.layout.tabs.skills', icon: Puzzle },
  mcp: { labelKey: 'settings.layout.tabs.mcp', icon: Server },
  hooks: { labelKey: 'settings.layout.tabs.hooks', icon: Webhook },
  plugins: { labelKey: 'settings.layout.tabs.plugins', icon: Blocks },
  cloud: { labelKey: 'settings.layout.tabs.cloud', icon: Cloud },
  models: { labelKey: 'settings.layout.tabs.models', icon: Cpu },
}

const CLAUDE_CONFIG_TABS: HarnessConfigSection[] = [
  'preferences',
  'agents',
  'skills',
  'mcp',
  'hooks',
  'plugins',
]

const CODEX_CONFIG_TABS: HarnessConfigSection[] = [
  'preferences',
  'skills',
  'mcp',
  'hooks',
  'plugins',
]

const CURSOR_CONFIG_TABS: HarnessConfigSection[] = [
  'account',
  'preferences',
  'models',
  'cloud',
]

const DSH_CONFIG_TABS: HarnessConfigSection[] = ['preferences', 'mcp', 'plugins']

/**
 * Harnesses whose only app-level settings are their session defaults. They had
 * no tabs at all before those defaults became per-harness, which is what made
 * Grok's permission mode unconfigurable.
 */
const SESSION_DEFAULTS_ONLY_TABS: HarnessConfigSection[] = ['preferences']

export function configTabsFor(provider: SettingsProvider | undefined): HarnessConfigSection[] | null {
  if (provider === 'claude') return CLAUDE_CONFIG_TABS
  if (provider === 'codex') return CODEX_CONFIG_TABS
  if (provider === 'cursor') return CURSOR_CONFIG_TABS
  if (provider === 'dsh') return DSH_CONFIG_TABS
  if (provider === 'acp' || provider === 'opencode') return SESSION_DEFAULTS_ONLY_TABS
  return null
}
