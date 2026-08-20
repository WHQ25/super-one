import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleStop, LayoutGrid, SquareArrowOutUpRight } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@superone/ui/components/ui/context-menu'
import { cn } from '@superone/ui/lib/utils'
import type { MiniAppWorkerInfo } from '@superone/shared/miniapp-types'
import { MiniAppIcon } from '../miniapp/MiniAppIcon'

interface MiniAppWorkerGroupProps {
  workers: MiniAppWorkerInfo[]
  onOpen: (appId: string) => void
  onStop: (appId: string) => void
}

export const MiniAppWorkerGroup = memo(function MiniAppWorkerGroup({
  workers,
  onOpen,
  onStop,
}: MiniAppWorkerGroupProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (workers.length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [workers.length])

  const formatUptime = useCallback((since: number) => {
    const total = Math.max(0, Math.floor((Date.now() - since) / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return t('sidebar.contextMenu.workerUptimeHM', { h, m })
    if (m > 0) return t('sidebar.contextMenu.workerUptimeMS', { m, s })
    return t('sidebar.contextMenu.workerUptimeS', { s })
  }, [t])

  if (workers.length === 0) return null

  return (
    <div className="overflow-hidden pl-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="group/worker flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70"
      >
        <ChevronRight className={cn(
          'hidden size-3.5 shrink-0 transition-transform duration-200 group-hover/worker:block',
          expanded && 'rotate-90',
        )} />
        <LayoutGrid className="size-3.5 shrink-0 group-hover/worker:hidden" />
        <span>{t('sidebar.contextMenu.miniApps')}</span>
        <span className="ml-auto text-[10px] text-sidebar-foreground/30">{workers.length}</span>
      </button>
      {expanded && (
        <div className="flex flex-col py-0.5 pl-2">
          {workers.map((worker) => (
            <ContextMenu key={worker.appId}>
              <ContextMenuTrigger asChild>
                <button
                  onClick={() => onOpen(worker.appId)}
                  className="group/wrow flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MiniAppIcon appId={worker.appId} className="size-4 shrink-0" />
                    <span className="truncate">{worker.name || worker.appId}</span>
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      onStop(worker.appId)
                    }}
                    className="hidden shrink-0 items-center justify-center rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-destructive group-hover/wrow:flex"
                  >
                    <CircleStop className="size-3.5" />
                  </span>
                  <span className="min-w-0 shrink truncate text-[10px] text-sidebar-foreground/40 group-hover/wrow:hidden">
                    {worker.statusText || formatUptime(worker.since)}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onOpen(worker.appId)}>
                  <SquareArrowOutUpRight className="size-3.5" />
                  {t('sidebar.contextMenu.openMiniApp')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onClick={() => onStop(worker.appId)}>
                  <CircleStop className="size-3.5" />
                  {t('sidebar.contextMenu.stopWorker')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </div>
  )
})
