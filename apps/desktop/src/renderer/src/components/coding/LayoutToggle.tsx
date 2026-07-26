import { PanelLeft, PanelLeftDashed, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { toggleSidebar, toggleActivitySide } from '@/lib/layout-actions'

const isMac = window.app.platform === 'darwin'

export function LayoutToggle() {
  const { t } = useTranslation()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const maximized = useActivityPanelStore((s) => s.maximized)
  const side = useActivityPanelStore((s) => s.side)
  // When maximized, chat is a floating overlay — side swap is meaningless.
  const showSideToggle = showPanel && !maximized

  return (
    <div className="mr-2 flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {showSidebar ? <PanelLeftDashed className="size-3.5" /> : <PanelLeft className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{t('tooltips.toggleSidebar')}</span> <CommandShortcut>{isMac ? '⌘B' : 'Ctrl+B'}</CommandShortcut>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showSideToggle && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleActivitySide}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {side === 'left' ? <PanelRightOpen className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {side === 'left' ? t('tooltips.moveChatLeft') : t('tooltips.moveChatRight')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
