import { useActiveSession } from '@/stores/chat'
import { useHasRealProject } from '@/stores/app'
import { ContextUsage } from '@/components/chat/ContextUsage'
import { PermissionModeSelector } from '@/components/chat/PermissionModeSelector'
import { ProjectSelector } from './ProjectSelector'
import { PanelBottom, PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatusBarProps {
  showBottomPanel: boolean
  showRightSidebar: boolean
  onToggleBottomPanel: () => void
  onToggleRightSidebar: () => void
}

export function StatusBar({
  showBottomPanel,
  showRightSidebar,
  onToggleBottomPanel,
  onToggleRightSidebar,
}: StatusBarProps) {
  const status = useActiveSession((s) => s.status)
  const hasRealProject = useHasRealProject()

  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-t border-border bg-background px-2 text-[11px] text-muted-foreground">
      {/* Panel toggle buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleBottomPanel}
          className={cn(
            'rounded p-0.5 transition-colors hover:text-foreground',
            showBottomPanel && 'text-foreground'
          )}
        >
          <PanelBottom className="size-3.5" />
        </button>
        <button
          onClick={onToggleRightSidebar}
          className={cn(
            'rounded p-0.5 transition-colors hover:text-foreground',
            showRightSidebar && 'text-foreground'
          )}
        >
          <PanelRight className="size-3.5" />
        </button>
      </div>

      <div className="h-3 w-px bg-border" />

      {/* Project selector */}
      {hasRealProject && <ProjectSelector compact />}

      <div className="flex-1" />

      {/* Context usage */}
      <ContextUsage />

      <div className="h-3 w-px bg-border" />

      {/* Permission mode */}
      <PermissionModeSelector />

      <div className="h-3 w-px bg-border" />

      {/* Status indicator */}
      <div className="flex items-center gap-1">
        <div
          className={cn(
            'size-1.5 rounded-full',
            status === 'idle' && 'bg-green-500',
            status === 'streaming' && 'bg-yellow-500 animate-pulse',
            status === 'error' && 'bg-red-500'
          )}
        />
        <span className="capitalize">{status}</span>
      </div>
    </div>
  )
}
