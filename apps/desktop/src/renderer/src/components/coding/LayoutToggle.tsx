import { PanelLeft, PanelLeftDashed, PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'

const isMac = window.app.platform === 'darwin'

export function LayoutToggle() {
  const { t } = useTranslation()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const side = useActivityPanelStore((s) => s.side)

  const toggleSidebar = () => useAppStore.getState().setShowSidebar(!showSidebar)
  const toggleSide = () => useActivityPanelStore.getState().toggleSide()

  return (
    <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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

      {showPanel && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleSide}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {side === 'left' ? <PanelLeft className="size-3.5" /> : <PanelRight className="size-3.5" />}
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
