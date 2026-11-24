import { PanelLeft, PanelLeftDashed, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { toggleSidebar, toggleActivitySide } from '@/lib/layout-actions'
import { CARD_HEADER_CHROME, LAYOUT_CONTROLS_WIDTH } from '@/lib/layout-constants'

function useShowSideToggle(): boolean {
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const fillsWindow = useActivityPanelStore(selectPanelFillsWindow)
  return showPanel && !fillsWindow
}

export function useLayoutControlsWidth(): number {
  return useShowSideToggle() ? LAYOUT_CONTROLS_WIDTH.DOUBLE : LAYOUT_CONTROLS_WIDTH.SINGLE
}

export function LayoutToggle({ placement = 'content' }: { placement?: 'content' | 'titlebar' | 'overlay' }) {
  const { t } = useTranslation()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const side = useActivityPanelStore((s) => s.side)
  const showSideToggle = useShowSideToggle()
  const platform = window.app.platform
  if ((platform === 'win32') !== (placement === 'titlebar')) return null

  return (
    <div className={cn('flex items-center gap-0.5', placement === 'content' && 'mr-2')} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <IconButton
        onClick={toggleSidebar}
        aria-label={t('tooltips.toggleSidebar')}
        aria-pressed={showSidebar}
        tooltip={<><span>{t('tooltips.toggleSidebar')}</span> <CommandShortcut>{platform === 'darwin' ? '⌘⌥B' : 'Ctrl+Alt+B'}</CommandShortcut></>}
        tooltipSide="bottom"
        tooltipSideOffset={4}
      >
        {showSidebar ? <PanelLeftDashed /> : <PanelLeft />}
      </IconButton>

      {showSideToggle && (
        <IconButton
          onClick={toggleActivitySide}
          tooltip={side === 'left' ? t('tooltips.moveChatLeft') : t('tooltips.moveChatRight')}
          tooltipSide="bottom"
          tooltipSideOffset={4}
        >
          {side === 'left' ? <PanelRightOpen /> : <PanelLeftOpen />}
        </IconButton>
      )}
    </div>
  )
}

export function WindowLayoutControls({
  scope,
  isFullscreen = false,
  onSidebar = false,
}: {
  scope: 'window' | 'card'
  isFullscreen?: boolean
  onSidebar?: boolean
}) {
  const platform = window.app.platform
  if (platform === 'win32') return null
  if (scope === 'window' && platform !== 'darwin') return null
  if (scope === 'card' && platform === 'darwin') return null

  const positionClass = scope === 'window'
    ? (isFullscreen ? 'top-0 left-2' : 'top-[5px] left-[84px]')
    : 'top-0 left-2'

  return (
    <div
      data-window-layout-controls=""
      data-on-sidebar={scope === 'window' && onSidebar ? 'true' : undefined}
      className={cn('absolute z-30 flex items-center', CARD_HEADER_CHROME.HEIGHT, positionClass)}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <LayoutToggle placement="overlay" />
    </div>
  )
}
