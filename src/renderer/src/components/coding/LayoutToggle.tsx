import { PanelLeft, PanelLeftDashed, PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'

const isMac = window.app.platform === 'darwin'

export function LayoutToggle() {
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
            <span>Toggle Sidebar</span> <CommandShortcut>{isMac ? '⌘B' : 'Ctrl+B'}</CommandShortcut>
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
              Move Chat to {side === 'left' ? 'Left' : 'Right'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
