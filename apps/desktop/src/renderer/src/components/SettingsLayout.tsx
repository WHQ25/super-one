import { lazy, Suspense } from 'react'
import { ArrowLeft, BarChart3, Brain, Cpu, Globe, LayoutGrid, Loader2, MousePointer2, Paintbrush, Settings, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useAppStore } from '@/stores/app'
import { ProvidersPage } from './ProvidersPage'
import { RemotePage } from './RemotePage'
import { AppsSettingsPage } from './AppsSettingsPage'
import { AppSettingsPage } from './AppSettingsPage'
import { AppearancePage } from './AppearancePage'
import { BrowserSettingsPage } from './BrowserSettingsPage'
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'
import { cn } from '@superone/ui/lib/utils'
import { isComputerUseSupportedPlatform } from '@/lib/computer-use-platform'

const UsagePage = lazy(() => import('./UsagePage').then((m) => ({ default: m.UsagePage })))

const globalTabs = [
  { id: 'app-settings' as const, labelKey: 'settings.layout.tabs.general', icon: Settings },
  { id: 'appearance' as const, labelKey: 'settings.layout.tabs.appearance', icon: Paintbrush },
  { id: 'providers' as const, labelKey: 'settings.layout.tabs.providers', icon: Brain },
  { id: 'harnesses' as const, labelKey: 'settings.layout.tabs.harnesses', icon: Cpu },
  { id: 'browser' as const, labelKey: 'settings.layout.tabs.browser', icon: Globe },
  { id: 'computer-use' as const, labelKey: 'settings.layout.tabs.computerUse', icon: MousePointer2 },
  { id: 'apps' as const, labelKey: 'settings.layout.tabs.apps', icon: LayoutGrid },
  { id: 'remote' as const, labelKey: 'settings.layout.tabs.remote', icon: Smartphone },
  { id: 'usage' as const, labelKey: 'settings.layout.tabs.usage', icon: BarChart3 },
]

export function SettingsLayout() {
  const { t } = useTranslation()
  const settingsTab = useAppStore((s) => s.settingsTab)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const navigateTo = useAppStore((s) => s.navigateTo)
  const computerUseSupported = isComputerUseSupportedPlatform(window.app.platform)
  const visibleGlobalTabs = computerUseSupported
    ? globalTabs
    : globalTabs.filter((tab) => tab.id !== 'computer-use')
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

        <nav className="flex flex-col gap-1">
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
        {activeSettingsTab === 'providers' && <ProvidersPage />}
        {activeSettingsTab === 'app-settings' && <AppSettingsPage />}
        {activeSettingsTab === 'appearance' && <AppearancePage />}
        {activeSettingsTab === 'harnesses' && <HarnessesSettingsPage />}
        {activeSettingsTab === 'browser' && <BrowserSettingsPage />}
        {activeSettingsTab === 'computer-use' && <ComputerUseSettingsPage />}
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
