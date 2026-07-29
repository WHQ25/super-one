import { lazy, Suspense } from 'react'
import { ArrowLeft, BarChart3, Blocks, Bot, Brain, Globe, LayoutGrid, Loader2, MousePointer2, Paintbrush, Palette, Puzzle, Server, Settings, Smartphone, Webhook } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useAppStore } from '@/stores/app'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { PluginsPage } from './PluginsPage'
import { HooksPage } from './HooksPage'
import { PreferencesPage } from './PreferencesPage'
import { ProvidersPage } from './ProvidersPage'
import { RemotePage } from './RemotePage'
import { AppsSettingsPage } from './AppsSettingsPage'
import { AppSettingsPage } from './AppSettingsPage'
import { AppearancePage } from './AppearancePage'
import { BrowserSettingsPage } from './BrowserSettingsPage'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { cn } from '@superone/ui/lib/utils'
import type { SettingsProvider } from '@superone/shared/agent-types'
import { isComputerUseSupportedPlatform } from '@/lib/computer-use-platform'

const UsagePage = lazy(() => import('./UsagePage').then((m) => ({ default: m.UsagePage })))

const globalTabs = [
  { id: 'app-settings' as const, labelKey: 'settings.layout.tabs.general', icon: Settings },
  { id: 'appearance' as const, labelKey: 'settings.layout.tabs.appearance', icon: Paintbrush },
  { id: 'providers' as const, labelKey: 'settings.layout.tabs.providers', icon: Brain },
  { id: 'browser' as const, labelKey: 'settings.layout.tabs.browser', icon: Globe },
  { id: 'computer-use' as const, labelKey: 'settings.layout.tabs.computerUse', icon: MousePointer2 },
  { id: 'apps' as const, labelKey: 'settings.layout.tabs.apps', icon: LayoutGrid },
  { id: 'remote' as const, labelKey: 'settings.layout.tabs.remote', icon: Smartphone },
  { id: 'usage' as const, labelKey: 'settings.layout.tabs.usage', icon: BarChart3 },
]

const providerTabs = [
  { id: 'agents' as const, labelKey: 'settings.layout.tabs.agents', icon: Bot },
  { id: 'skills' as const, labelKey: 'settings.layout.tabs.skills', icon: Puzzle },
  { id: 'mcp' as const, labelKey: 'settings.layout.tabs.mcp', icon: Server },
  { id: 'hooks' as const, labelKey: 'settings.layout.tabs.hooks', icon: Webhook },
  { id: 'plugins' as const, labelKey: 'settings.layout.tabs.plugins', icon: Blocks },
  { id: 'preferences' as const, labelKey: 'settings.layout.tabs.preferences', icon: Palette },
]

const codexTabs = new Set<string>(['skills', 'mcp', 'hooks', 'plugins', 'preferences'])

const providers: { id: SettingsProvider; labelKey: string }[] = [
  { id: 'claude', labelKey: 'settings.layout.providers.claude' },
  { id: 'codex', labelKey: 'settings.layout.providers.codex' },
]

export function SettingsLayout() {
  const { t } = useTranslation()
  const settingsTab = useAppStore((s) => s.settingsTab)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const settingsProvider = useAppStore((s) => s.settingsProvider)
  const setSettingsProvider = useAppStore((s) => s.setSettingsProvider)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const computerUseSupported = isComputerUseSupportedPlatform(window.app.platform)
  const visibleGlobalTabs = computerUseSupported
    ? globalTabs
    : globalTabs.filter((tab) => tab.id !== 'computer-use')
  const activeSettingsTab = !computerUseSupported && settingsTab === 'computer-use'
    ? 'app-settings'
    : settingsTab

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
          {t('common.back')}
        </Button>

        <nav className="flex flex-col gap-1 mb-3">
          {visibleGlobalTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                activeSettingsTab === tab.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <div className="border-t border-border pt-3 mb-3">
          <Tabs value={settingsProvider} onValueChange={(v) => setSettingsProvider(v as SettingsProvider)}>
            <TabsList>
              {providers.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className="py-2">
                  {t(p.labelKey)}
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
                activeSettingsTab === tab.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
        {activeSettingsTab === 'providers' && <ProvidersPage />}
        {activeSettingsTab === 'agents' && <AgentsPage />}
        {activeSettingsTab === 'skills' && <SkillsPage />}
        {activeSettingsTab === 'mcp' && <McpPage />}
        {activeSettingsTab === 'hooks' && <HooksPage />}
        {activeSettingsTab === 'plugins' && <PluginsPage />}
        {activeSettingsTab === 'app-settings' && <AppSettingsPage />}
        {activeSettingsTab === 'appearance' && <AppearancePage />}
        {activeSettingsTab === 'browser' && <BrowserSettingsPage />}
        {activeSettingsTab === 'computer-use' && <ComputerUseSettingsPage />}
        {activeSettingsTab === 'apps' && <AppsSettingsPage />}
        {activeSettingsTab === 'preferences' && <PreferencesPage />}
        {activeSettingsTab === 'remote' && <RemotePage />}
        {activeSettingsTab === 'usage' && (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
            <UsagePage />
          </Suspense>
        )}
      </div>
    </div>
  )
}
