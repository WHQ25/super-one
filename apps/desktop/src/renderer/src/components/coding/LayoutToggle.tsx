import { PanelLeft, PanelLeftDashed, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { toggleSidebar, toggleActivitySide } from '@/lib/layout-actions'

export function LayoutToggle({ placement = 'content' }: { placement?: 'content' | 'titlebar' }) {
  const { t } = useTranslation()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const maximized = useActivityPanelStore((s) => s.maximized)
  const side = useActivityPanelStore((s) => s.side)
  // When maximized, chat is a floating overlay — side swap is meaningless.
  const showSideToggle = showPanel && !maximized
  const platform = window.app.platform
  // Windows owns these controls in its window chrome in every workspace layout.
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
