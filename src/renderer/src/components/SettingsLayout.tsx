import { ArrowLeft, Blocks, Bot, Globe, LayoutGrid, Palette, Puzzle, Server, Settings, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { PluginsPage } from './PluginsPage'
import { PreferencesPage } from './PreferencesPage'
import { ProvidersPage } from './ProvidersPage'
import { RemotePage } from './RemotePage'
import { AppsSettingsPage } from './AppsSettingsPage'
import { AppSettingsPage } from './AppSettingsPage'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { SettingsProvider } from '../../../shared/agent-types'

const globalTabs = [
  { id: 'app-settings' as const, label: 'General', icon: Settings },
  { id: 'apps' as const, label: 'Mini Apps', icon: LayoutGrid },
  { id: 'remote' as const, label: 'Remote Control', icon: Smartphone },
]

const providerTabs = [
  { id: 'providers' as const, label: 'Providers', icon: Globe },
  { id: 'agents' as const, label: 'Subagents', icon: Bot },
  { id: 'skills' as const, label: 'Skills', icon: Puzzle },
  { id: 'mcp' as const, label: 'MCP Servers', icon: Server },
  { id: 'plugins' as const, label: 'Plugins', icon: Blocks },
  { id: 'preferences' as const, label: 'Preference', icon: Palette },
]

const codexTabs = new Set<string>(['providers', 'skills', 'mcp', 'plugins', 'preferences'])

const providers: { id: SettingsProvider; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
]

export function SettingsLayout() {
  const settingsTab = useAppStore((s) => s.settingsTab)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const setSettingsProvider = useAppStore((s) => s.setSettingsProvider)
  const navigateTo = useAppStore((s) => s.navigateTo)

  const visibleProviderTabs = settingsProvider === 'codex'
    ? providerTabs.filter((t) => codexTabs.has(t.id))
    : providerTabs

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-background p-3">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 justify-start"
          onClick={() => navigateTo('main')}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <nav className="flex flex-col gap-1 mb-3">
          {globalTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                settingsTab === tab.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-border pt-3 mb-3">
          <Tabs value={settingsProvider} onValueChange={(v) => setSettingsProvider(v as SettingsProvider)}>
            <TabsList className="border-0 bg-muted">
              {providers.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className="py-1">
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <nav className="flex flex-col gap-1">
          {visibleProviderTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                settingsTab === tab.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {settingsTab === 'providers' && <ProvidersPage />}
        {settingsTab === 'agents' && <AgentsPage />}
        {settingsTab === 'skills' && <SkillsPage />}
        {settingsTab === 'mcp' && <McpPage />}
        {settingsTab === 'plugins' && <PluginsPage />}
        {settingsTab === 'app-settings' && <AppSettingsPage />}
        {settingsTab === 'apps' && <AppsSettingsPage />}
        {settingsTab === 'preferences' && <PreferencesPage />}
        {settingsTab === 'remote' && <RemotePage />}
      </div>
    </div>
  )
}
