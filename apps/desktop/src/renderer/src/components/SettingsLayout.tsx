import { lazy, Suspense } from 'react'
import { ArrowLeft, BarChart3, Brain, Cpu, Globe, LayoutGrid, Loader2, MousePointer2, Paintbrush, Settings, Smartphone, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/app'
import { ProvidersPage } from './ProvidersPage'
import { RemotePage } from './RemotePage'
import { AppsSettingsPage } from './AppsSettingsPage'
import { AppSettingsPage } from './AppSettingsPage'
import { AppearancePage } from './AppearancePage'
import { BrowserSettingsPage } from './BrowserSettingsPage'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'
import { TerminalSettingsPage } from './TerminalSettingsPage'
import { SettingsNavGroup, SettingsNavItem } from './settings/SettingsNav'
import { isComputerUseSupportedPlatform } from '@/lib/computer-use-platform'

const UsagePage = lazy(() => import('./UsagePage').then((m) => ({ default: m.UsagePage })))

const tabGroups = [
  {
    labelKey: 'settings.layout.groups.app',
    tabs: [
      { id: 'app-settings' as const, labelKey: 'settings.layout.tabs.general', icon: Settings },
      { id: 'appearance' as const, labelKey: 'settings.layout.tabs.appearance', icon: Paintbrush },
      { id: 'usage' as const, labelKey: 'settings.layout.tabs.usage', icon: BarChart3 },
    ],
  },
  {
    labelKey: 'settings.layout.groups.agent',
    tabs: [
      { id: 'providers' as const, labelKey: 'settings.layout.tabs.providers', icon: Brain },
      { id: 'harnesses' as const, labelKey: 'settings.layout.tabs.harnesses', icon: Cpu },
    ],
  },
  {
    labelKey: 'settings.layout.groups.capabilities',
    tabs: [
      { id: 'browser' as const, labelKey: 'settings.layout.tabs.browser', icon: Globe },
      { id: 'computer-use' as const, labelKey: 'settings.layout.tabs.computerUse', icon: MousePointer2 },
      { id: 'terminal' as const, labelKey: 'settings.layout.tabs.terminal', icon: SquareTerminal },
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
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const computerUseSupported = isComputerUseSupportedPlatform(window.app.platform)
  // Map removed tabs (e.g. former Environments) onto their new homes.
  const resolvedSettingsTab =
    (settingsTab as string) === 'environments' ? 'remote' : settingsTab
  const activeSettingsTab =
    !computerUseSupported && resolvedSettingsTab === 'computer-use'
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
        </nav>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {activeSettingsTab === 'providers' && <ProvidersPage />}
        {activeSettingsTab === 'app-settings' && <AppSettingsPage />}
        {activeSettingsTab === 'appearance' && <AppearancePage />}
        {activeSettingsTab === 'harnesses' && <HarnessesSettingsPage />}
        {activeSettingsTab === 'browser' && <BrowserSettingsPage />}
        {activeSettingsTab === 'computer-use' && <ComputerUseSettingsPage />}
        {activeSettingsTab === 'terminal' && <TerminalSettingsPage />}
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
