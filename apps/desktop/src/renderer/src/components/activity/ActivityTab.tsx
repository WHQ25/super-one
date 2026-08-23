import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { Bug, Globe, Maximize, RotateCw, Route, Shrink, Smartphone, Terminal as TerminalIcon, X } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'
import { useBrowserStore } from '@/stores/browser'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { BrowserFavicon } from '@/components/browser/BrowserFavicon'
import { useDeviceTabActions } from '@/components/device/device-tab-actions'
import { deviceFamilyIcon } from '@/components/device/device-icons'
import { closeActivityTerminalTab, closeBrowserTab, closeDeviceTab, closeTrajectoryTab, toggleMaximizedActivityGroup } from './activity-panel-api'

function useIsActive(api: IDockviewPanelHeaderProps['api']) {
  const [active, setActive] = useState(api.isActive)
  useEffect(() => {
    setActive(api.isActive)
    const d = api.onDidActiveChange((e) => setActive(e.isActive))
    return () => d.dispose()
  }, [api])
  return active
}

function usePanelTitle(api: IDockviewPanelHeaderProps['api']) {
  const [title, setTitle] = useState(api.title)
  useEffect(() => {
    setTitle(api.title)
    const d = api.onDidTitleChange((e) => setTitle(e.title))
    return () => d.dispose()
  }, [api])
  return title
}

/**
 * A leading icon that becomes a dismiss button while its row is hovered.
 *
 * The X takes the icon's place rather than sitting beside it, so the row never
 * changes width — and it carries its own round fill, which is what makes it
 * read as a hit target instead of a decoration on the row behind it.
 *
 * `label` names what is being dismissed. It defaults to "Close" for tabs, where
 * the row title already says what would close; anywhere else, say it.
 */
export function HoverCloseSlot({
  children,
  onClose,
  label = 'Close',
}: {
  children: React.ReactNode
  onClose: () => void
  label?: string
}) {
  return (
    <div className="relative size-3.5 shrink-0">
      <div className="absolute inset-0 transition-opacity [div:hover>div>&]:opacity-0">
        {children}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/15 text-foreground/80 opacity-0 transition-opacity hover:bg-foreground/25 [div:hover>div>&]:opacity-100"
        title={label}
        aria-label={label}
      >
        <X className="size-2.5" strokeWidth={2.5} />
      </button>
    </div>
  )
}

export function tabChipClass(active: boolean): string {
  return cn(
    'flex max-w-[180px] items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground',
  )
}

export function FilePreviewTab(props: IDockviewPanelHeaderProps<{ filePath: string }>) {
  const fileName = props.params.filePath.split('/').pop() ?? ''
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => props.api.close()}>
        {fileName && <FileIcon name={fileName} size={14} className="shrink-0" />}
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">{fileName || 'File'}</span>
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

function TabActionButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <motion.button
      initial={false}
      animate={{
        width: active ? 16 : 0,
        marginLeft: active ? 2 : 0,
        opacity: active ? 1 : 0,
      }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onClick={onClick}
      className="flex h-4 shrink-0 items-center justify-center overflow-hidden rounded text-foreground/60 hover:text-foreground"
      title={title}
    >
      {children}
    </motion.button>
  )
}

function MaximizeTabAction({ api, active }: { api: IDockviewPanelHeaderProps['api']; active: boolean }) {
  const { t } = useTranslation()
  const maximizedGroupId = useActivityPanelStore((s) => s.maximizedGroupId)
  const maximized = maximizedGroupId === api.group.id
  const Icon = maximized ? Shrink : Maximize
  return (
    <TabActionButton
      active={active}
      onClick={(e) => { e.stopPropagation(); toggleMaximizedActivityGroup(api.id) }}
      title={t(maximized ? 'tooltips.restoreActivityPanel' : 'tooltips.maximizeActivityPanel')}
    >
      <Icon className="size-3 shrink-0" />
    </TabActionButton>
  )
}

export function MiniAppTab(props: IDockviewPanelHeaderProps<{ instanceKey: string; appId: string }>) {
  const { instanceKey, appId } = props.params
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const closeApp = useMiniAppStore((s) => s.closeApp)
  const devControls = useMiniAppStore((s) => s.devControls[instanceKey])
  const isDev = app?.manifest.isDev === true
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => { void closeApp(instanceKey) }}>
        <MiniAppIcon appId={appId} className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">{props.api.title}</span>
      {isDev && devControls && (
        <>
          <TabActionButton
            active={active}
            onClick={(e) => { e.stopPropagation(); devControls.reload() }}
            title="Reload"
          >
            <RotateCw className="size-3 shrink-0" />
          </TabActionButton>
          <TabActionButton
            active={active}
            onClick={(e) => { e.stopPropagation(); devControls.openDevTools() }}
            title="Open devtools"
          >
            <Bug className="size-3 shrink-0" />
          </TabActionButton>
        </>
      )}
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

export function BrowserTab(props: IDockviewPanelHeaderProps<{ browserId: string }>) {
  const { browserId } = props.params
  const active = useIsActive(props.api)
  const state = useBrowserStore((s) => s.tabs[browserId])
  const title = state?.title || 'New Tab'

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => closeBrowserTab(browserId)}>
        <BrowserFavicon
          src={state?.favicon}
          url={state?.url}
          preferSrc
          className="size-3.5 shrink-0"
          fallback={<Globe className="size-3.5 shrink-0" />}
        />
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">{title}</span>
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

export function TerminalTab(props: IDockviewPanelHeaderProps<{ terminalId: string }>) {
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => closeActivityTerminalTab(props.params.terminalId)}>
        <TerminalIcon className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">{title || 'Terminal'}</span>
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

export function TrajectoryTab(props: IDockviewPanelHeaderProps<{ sessionId: string }>) {
  const { t } = useTranslation()
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => closeTrajectoryTab(props.params.sessionId)}>
        <Route className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">{title || t('trajectory.title')}</span>
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

export function DeviceTab(props: IDockviewPanelHeaderProps<{ instanceId: string }>) {
  const { t } = useTranslation()
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  // Absent until the panel body mounts and registers itself, which is also exactly
  // when there is a device list worth re-reading.
  const actions = useDeviceTabActions((s) => s.byInstance[props.params.instanceId])
  // The device the panel is showing, which is what this tab is FOR. A session can hold
  // two at once, and two tabs both reading "Device" cannot be told apart without
  // clicking one. Falls back only while the panel is empty.
  const device = actions?.device ?? null
  const Icon = device ? deviceFamilyIcon(device.provider, device.kind) : Smartphone
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => closeDeviceTab(props.params.instanceId)}>
        <Icon className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <span className="min-w-0 truncate text-xs">
        {device?.name || title || t('activity.device.title')}
      </span>
      {actions && (
        <TabActionButton
          active={active}
          onClick={(e) => { e.stopPropagation(); actions.refresh() }}
          title={t('activity.device.refresh')}
        >
          <RotateCw className={cn('size-3 shrink-0', actions.busy && 'animate-spin')} />
        </TabActionButton>
      )}
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

export const activityTabComponents: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  'file-preview-tab': FilePreviewTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'miniapp-tab': MiniAppTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'browser-tab': BrowserTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'terminal-tab': TerminalTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'trajectory-tab': TrajectoryTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'device-tab': DeviceTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
}
