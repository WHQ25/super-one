import { mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IDockviewPanelHeaderProps } from 'dockview-core'
import { Bot, Bug, Globe, Maximize, MessageCirclePlus, RotateCw, Route, Shrink, Smartphone, Terminal as TerminalIcon, Volume2, VolumeOff, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { tabChipClass, TabTitle, TabActionButton } from './ActivityTabChrome'
export { tabChipClass, TabTitle, TabActionButton } from './ActivityTabChrome'
import { isDevAppEntry } from '@superone/shared/miniapp-types'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MiniAppDevServerBadge } from '@/components/miniapp/MiniAppDevServerBadge'
import { useMiniAppStore } from '@/stores/miniapp'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { useBrowserStore } from '@/stores/browser'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { BrowserFavicon } from '@/components/browser/BrowserFavicon'
import { browserSetMuted } from '@/components/browser/browser-host-api'
import { useDeviceTabActions } from '@/components/device/device-tab-actions'
import { deviceFamilyIcon } from '@/components/device/device-icons'
import { closeActivityTerminalTab, closeBrowserTab, closeDeviceTab, closeToolUiPreviewTab, closeTrajectoryTab, toggleMaximizedActivityGroup } from './activity-panel-api'
import { useTerminalAgentControl } from './activity-terminal'
import { requestCloseSideChat } from '@/lib/side-chat-actions'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { useMcpAppLayout } from '@/components/mcp-apps/layout-store'

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

export function FilePreviewTab(props: IDockviewPanelHeaderProps<{ filePath: string }>) {
  const fileName = props.params.filePath.split('/').pop() ?? ''
  const active = useIsActive(props.api)

  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => props.api.close()}>
        {fileName && <FileIcon name={fileName} size={14} className="shrink-0" />}
      </HoverCloseSlot>
      <TabTitle>{fileName || 'File'}</TabTitle>
      <MaximizeTabAction api={props.api} active={active} />
    </div>
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
      <TabTitle>{props.api.title}</TabTitle>
      {app && isDevAppEntry(app) && <MiniAppDevServerBadge appId={appId} />}
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

export function ToolUiPreviewTab(props: IDockviewPanelHeaderProps<{ previewKey: string }>) {
  const { t } = useTranslation()
  const { previewKey } = props.params
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  const appId = useToolUiPreviewStore((s) => s.previews[previewKey]?.appId)
  const close = () => {
    closeToolUiPreviewTab(previewKey)
    useToolUiPreviewStore.getState().remove(previewKey)
  }
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={close}>
        {appId ? <MiniAppIcon appId={appId} className="size-3.5 shrink-0" /> : <Bug className="size-3.5 shrink-0" />}
      </HoverCloseSlot>
      <TabTitle>{title || t('activity.toolPreview.title')}</TabTitle>
      {appId && <MiniAppDevServerBadge appId={appId} />}
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
      <TabTitle>{title}</TabTitle>
      <BrowserAudioToggle browserId={browserId} />
      <MaximizeTabAction api={props.api} active={active} />
    </div>
  )
}

/**
 * Chrome's tab speaker: shown on every tab that is making sound, not just the
 * active one, since finding the noisy tab is the whole point. A muted tab keeps
 * its icon so it stays one click from unmuting.
 */
function BrowserAudioToggle({ browserId }: { browserId: string }) {
  const { t } = useTranslation()
  const audible = useBrowserStore((s) => s.tabs[browserId]?.audible ?? false)
  const muted = useBrowserStore((s) => s.tabs[browserId]?.muted ?? false)
  if (!audible && !muted) return null
  const Icon = muted ? VolumeOff : Volume2
  const label = t(muted ? 'tooltips.unmuteTab' : 'tooltips.muteTab')
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (browserSetMuted(browserId, !muted)) useBrowserStore.getState().patch(browserId, { muted: !muted })
  }
  return (
    <button
      onClick={toggle}
      className="flex size-4 shrink-0 items-center justify-center rounded text-foreground/60 hover:text-foreground"
      title={label}
      aria-label={label}
      aria-pressed={muted}
    >
      <Icon className="size-3 shrink-0" />
    </button>
  )
}

export function TerminalTab(props: IDockviewPanelHeaderProps<{ terminalId: string }>) {
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  const agentControl = useTerminalAgentControl(props.params.terminalId)
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => closeActivityTerminalTab(props.params.terminalId)}>
        {agentControl ? <Bot className="size-3.5 shrink-0" /> : <TerminalIcon className="size-3.5 shrink-0" />}
      </HoverCloseSlot>
      <TabTitle>{title || 'Terminal'}</TabTitle>
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
      <TabTitle>{title || t('trajectory.title')}</TabTitle>
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
      <TabTitle>{device?.name || title || t('activity.device.title')}</TabTitle>
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

export function SideChatTab(props: IDockviewPanelHeaderProps) {
  const { t } = useTranslation()
  const active = useIsActive(props.api)
  const title = usePanelTitle(props.api)
  // Closing is destructive, so the X asks first — `requestCloseSideChat` opens the
  // confirm dialog and only calls back into the dock once the user agrees.
  //
  // No maximize action, unlike every other tab: a side chat only means anything
  // next to the thread it forked from, so covering that thread with it is never
  // what the user wanted.
  return (
    <div className={tabChipClass(active)}>
      <HoverCloseSlot onClose={() => { void requestCloseSideChat() }}>
        <MessageCirclePlus className="size-3.5 shrink-0" />
      </HoverCloseSlot>
      <TabTitle>{title || t('sideChat.title')}</TabTitle>
    </div>
  )
}

export function McpAppTab(props: IDockviewPanelHeaderProps<{ appInstanceId: string }>) {
  const key = props.params.appInstanceId
  const owner = useMcpAppLayout(state => state.views[key])
  const server = owner?.app.presentation?.serverTitle ?? owner?.app.binding.server ?? props.api.title
  const fallbackIcon = useMcpServerIcon(owner?.app.binding.server)
  const icon = mcpAppPresentationIcon(owner?.app.presentation) ?? fallbackIcon
  const active = useIsActive(props.api)
  return <div className={tabChipClass(active)}>
    <HoverCloseSlot onClose={() => props.api.close()}>
      <ToolBrandIcon src={icon} alt={server} icon={getToolDisplay(owner?.toolName ?? `mcp__${server}__app`, {}).icon} />
    </HoverCloseSlot>
    <TabTitle>{owner?.app.file?.name ?? server}</TabTitle>
    <MaximizeTabAction api={props.api} active={active} />
  </div>
}

export const activityTabComponents: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  'mcp-app-tab': McpAppTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'file-preview-tab': FilePreviewTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'miniapp-tab': MiniAppTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'miniapp-tool-preview-tab': ToolUiPreviewTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'browser-tab': BrowserTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'terminal-tab': TerminalTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'trajectory-tab': TrajectoryTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'device-tab': DeviceTab as React.FunctionComponent<IDockviewPanelHeaderProps>,
  'side-chat-tab': SideChatTab,
}
