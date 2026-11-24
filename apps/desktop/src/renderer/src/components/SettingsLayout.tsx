import { lazy, Suspense } from 'react'
import { SlotList, useSlotList, useSlotVersion } from '@superone/ui-slots/react'
import { PluginSlotErrorBoundary } from '@/lib/ui-slots'
import { ArrowLeft, BarChart3, Bot, Brain, Code2, Cpu, Globe, HardDrive, LayoutGrid, Loader2, MousePointer2, Paintbrush, Settings, Smartphone, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SettingsTab } from '@/stores/app'
import { useAppStore } from '@/stores/app'
import { ProvidersPage } from './ProvidersPage'
import { RemotePage } from './RemotePage'
import { AppsSettingsPage } from './AppsSettingsPage'
import { AppSettingsPage } from './AppSettingsPage'
import { AppearancePage } from './AppearancePage'
import { StorageSettingsPage } from './settings/StorageSettingsPage'
import { BrowserSettingsPage } from './BrowserSettingsPage'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'
import { TerminalSettingsPage } from './TerminalSettingsPage'
import { EditorSettingsPage } from './EditorSettingsPage'
import { SettingsNavGroup, SettingsNavItem } from './settings/SettingsNav'
import { isComputerUseSupportedPlatform } from '@/lib/computer-use-platform'

const AgentProfilesPage = lazy(() => import('./AgentProfilesPage').then((m) => ({ default: m.AgentProfilesPage })))

const UsagePage = lazy(() => import('./UsagePage').then((m) => ({ default: m.UsagePage })))

const tabGroups = [
  {
    labelKey: 'settings.layout.groups.app',
    tabs: [
      { id: 'app-settings' as const, labelKey: 'settings.layout.tabs.general', icon: Settings },
      { id: 'appearance' as const, labelKey: 'settings.layout.tabs.appearance', icon: Paintbrush },
      { id: 'storage' as const, labelKey: 'settings.layout.tabs.storage', icon: HardDrive },
      { id: 'usage' as const, labelKey: 'settings.layout.tabs.usage', icon: BarChart3 },
    ],
  },
  {
    labelKey: 'settings.layout.groups.agent',
    tabs: [
      { id: 'providers' as const, labelKey: 'settings.layout.tabs.providers', icon: Brain },
      { id: 'harnesses' as const, labelKey: 'settings.layout.tabs.harnesses', icon: Cpu },
      { id: 'agent-profiles' as const, labelKey: 'settings.layout.tabs.agentProfiles', icon: Bot },
    ],
  },
  {
    labelKey: 'settings.layout.groups.capabilities',
    tabs: [
      { id: 'browser' as const, labelKey: 'settings.layout.tabs.browser', icon: Globe },
      { id: 'computer-use' as const, labelKey: 'settings.layout.tabs.computerUse', icon: MousePointer2 },
      { id: 'terminal' as const, labelKey: 'settings.layout.tabs.terminal', icon: SquareTerminal },
      { id: 'editor' as const, labelKey: 'settings.layout.tabs.editor', icon: Code2 },
      { id: 'apps' as const, labelKey: 'settings.layout.tabs.apps', icon: LayoutGrid },
    ],
  },
  {
    labelKey: 'settings.layout.groups.connections',
    tabs: [
      { id: 'remote' as const, labelKey: 'settings.layout.tabs.remote', icon: Smartphone },
    ],
  },
]

export function SettingsLayout() {
  const { t } = useTranslation()
  const settingsTab = useAppStore((s) => s.settingsTab)
  const agentProfilesEnabled = useAppStore((s) => s.experimentalAgentProfilesEnabled)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const computerUseSupported = isComputerUseSupportedPlatform(window.app.platform)
  const settingsPageEntries = useSlotList('shell.settings.pages')
  const settingsSlotVersion = useSlotVersion('shell.settings.pages')
  const builtInTabs = new Set<string>(tabGroups.flatMap((g) => g.tabs.map((tab) => tab.id)))
  const resolvedSettingsTab =
    (settingsTab as string) === 'environments' ? 'remote' : settingsTab
  const activeSettingsTab =
    (!computerUseSupported && resolvedSettingsTab === 'computer-use')
      || (!agentProfilesEnabled && resolvedSettingsTab === 'agent-profiles')
      || (!builtInTabs.has(resolvedSettingsTab) && settingsPageEntries.length === 0)
      ? 'app-settings'
      : resolvedSettingsTab

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border px-2.5 pt-1 pb-3">
        <SettingsNavItem
          icon={<ArrowLeft className="size-4 shrink-0" />}
          onClick={() => navigateTo('main')}
        >
          {t('common.back')}
        </SettingsNavItem>

        <nav className="flex flex-col">
          {tabGroups.map((group) => (
            <SettingsNavGroup key={group.labelKey} label={t(group.labelKey)}>
              {group.tabs
                .filter((tab) => computerUseSupported || tab.id !== 'computer-use')
                .filter((tab) => agentProfilesEnabled || tab.id !== 'agent-profiles')
                .map((tab) => (
                  <SettingsNavItem
                    key={tab.id}
                    selected={activeSettingsTab === tab.id}
                    icon={<tab.icon className="size-4 shrink-0" />}
                    onClick={() => setSettingsTab(tab.id)}
                  >
                    {t(tab.labelKey)}
                  </SettingsNavItem>
                ))}
            </SettingsNavGroup>
          ))}
          <PluginSlotErrorBoundary resetKey={String(settingsSlotVersion)} fallback={null}>
            <SlotList name="shell.settings.pages" props={{ area: 'nav', activeTab: activeSettingsTab, onSelectTab: (tabId) => setSettingsTab(tabId as SettingsTab) }} />
          </PluginSlotErrorBoundary>
        </nav>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <PluginSlotErrorBoundary resetKey={`${activeSettingsTab}:${settingsSlotVersion}`} fallback={null}>
          <SlotList name="shell.settings.pages" props={{ area: 'content', activeTab: activeSettingsTab, onSelectTab: (tabId) => setSettingsTab(tabId as SettingsTab) }} />
        </PluginSlotErrorBoundary>
        {activeSettingsTab === 'providers' && <ProvidersPage />}
        {activeSettingsTab === 'app-settings' && <AppSettingsPage />}
        {activeSettingsTab === 'appearance' && <AppearancePage />}
        {activeSettingsTab === 'storage' && <StorageSettingsPage />}
        {activeSettingsTab === 'harnesses' && <HarnessesSettingsPage />}
        {activeSettingsTab === 'agent-profiles' && <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}><AgentProfilesPage /></Suspense>}
        {activeSettingsTab === 'browser' && <BrowserSettingsPage />}
        {activeSettingsTab === 'computer-use' && <ComputerUseSettingsPage />}
        {activeSettingsTab === 'terminal' && <TerminalSettingsPage />}
        {activeSettingsTab === 'editor' && <EditorSettingsPage />}
        {activeSettingsTab === 'apps' && <AppsSettingsPage />}
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
