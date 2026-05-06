import { useState, useMemo, useCallback, type DragEvent } from 'react'
import { Search, GripVertical, PackagePlus } from 'lucide-react'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@superone/ui/lib/utils'
import { openMiniAppTab } from '@/components/activity/activity-panel-api'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import { InstallPermissionDialog } from '@/components/miniapp/InstallPermissionDialog'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const S1APP_EXT = '.s1app'

function SortableSidebarApp({ app, index, onOpen }: { app: MiniAppEntry; index: number; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/sapp flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent',
        isDragging && 'z-10 opacity-80 shadow-sm',
      )}
      onClick={onOpen}
    >
      <MiniAppIcon appId={app.id} className="size-7 shrink-0" />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate">{app.manifest.name}</span>
          {index <= 9 && <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[10px] leading-none text-sidebar-foreground/60">{index < 9 ? index + 1 : 0}</span>}
        </span>
        {app.manifest.description && <MarqueeText className="text-[11px] text-sidebar-foreground/50">{app.manifest.description}</MarqueeText>}
      </div>
      <div
        {...attributes}
        {...listeners}
        className="ml-auto shrink-0 cursor-grab rounded p-0.5 text-sidebar-foreground/30 opacity-0 transition-opacity hover:text-sidebar-foreground/60 group-hover/sapp:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </div>
    </div>
  )
}

function isS1AppFile(e: DragEvent): boolean {
  const items = e.dataTransfer.items
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') return true
  }
  return false
}

function getS1AppPaths(e: DragEvent): string[] {
  const paths: string[] = []
  const files = e.dataTransfer.files
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const path = window.app.getPathForFile(file)
    if (path.endsWith(S1APP_EXT)) paths.push(path)
  }
  return paths
}

export function AppsPanel() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)

  const sidebarApps = useMiniAppStore(useShallow((s) => s.apps.filter((a) => a.manifest.type === 'sidebar')))
  const panelApps = useMiniAppStore(useShallow((s) => s.apps.filter((a) => !a.manifest.type || a.manifest.type === 'panel')))
  const fullscreenApps = useMiniAppStore(useShallow((s) => s.apps.filter((a) => a.manifest.type === 'fullscreen')))
  const requestOpenInCanvas = useMiniAppStore((s) => s.requestOpenInCanvas)
  const setLayoutMode = useAppStore((s) => s.setLayoutMode)
  const previewInstall = useMiniAppStore((s) => s.previewInstall)

  const [appSearch, setAppSearch] = useState('')
  const filteredPanelApps = appSearch
    ? panelApps.filter((a) => a.manifest.name.toLowerCase().includes(appSearch.toLowerCase()))
    : panelApps

  const [sidebarAppOrder, setSidebarAppOrder] = useState<string[]>([])
  const orderedSidebarApps = useMemo(() => {
    if (sidebarAppOrder.length === 0) return sidebarApps
    const orderMap = new Map(sidebarAppOrder.map((id, i) => [id, i]))
    return [...sidebarApps].sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity))
  }, [sidebarApps, sidebarAppOrder])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = orderedSidebarApps.map((a) => a.id)
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    setSidebarAppOrder(arrayMove(ids, oldIdx, newIdx))
  }, [orderedSidebarApps])

  const [isDragOver, setIsDragOver] = useState(false)
  const [installStatus, setInstallStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleFileDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isS1AppFile(e)) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleFileDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleFileDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const paths = getS1AppPaths(e)
    if (paths.length === 0) {
      setInstallStatus({ type: 'error', message: 'Not a .s1app file' })
      setTimeout(() => setInstallStatus(null), 3000)
      return
    }

    try {
      await previewInstall(paths[0])
    } catch (err) {
      setInstallStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid package',
      })
      setTimeout(() => setInstallStatus(null), 3000)
    }
  }, [previewInstall])

  const handleInstalled = useCallback((name: string, upgraded: boolean) => {
    setInstallStatus({
      type: 'success',
      message: upgraded ? `${name} upgraded` : `${name} installed`,
    })
    setTimeout(() => setInstallStatus(null), 3000)
  }, [])

  const handleInstallError = useCallback((message: string) => {
    setInstallStatus({ type: 'error', message })
    setTimeout(() => setInstallStatus(null), 3000)
  }, [])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <InstallPermissionDialog onInstalled={handleInstalled} onError={handleInstallError} />
      <div className="relative mx-2 mt-1 mb-1">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
        <input
          value={appSearch}
          onChange={(e) => setAppSearch(e.target.value)}
          placeholder="Search apps..."
          className="w-full rounded-full border border-sidebar-border bg-sidebar py-1.5 pl-8 pr-3 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-accent"
        />
      </div>

      {installStatus && (
        <div className={cn(
          'mx-2 mb-1 rounded-md px-2.5 py-1.5 text-xs',
          installStatus.type === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          installStatus.type === 'error' && 'bg-red-500/10 text-red-600 dark:text-red-400',
        )}>
          {installStatus.message}
        </div>
      )}

      <ScrollArea className="h-full">
        <div className={cn(
          'relative flex w-0 min-w-full flex-col px-2 py-1',
          isDragOver && 'pointer-events-none',
        )}>
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-orange-600/60 dark:border-orange-400/60 bg-orange-50/50 dark:bg-orange-950/20">
              <PackagePlus className="mb-2 size-8 text-orange-500/70" />
              <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Drop .s1app to install</span>
            </div>
          )}
          {sidebarApps.length > 0 && (
            <>
              <span className="px-1 py-1.5 text-xs font-medium text-sidebar-foreground/70">Sidebar</span>
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={orderedSidebarApps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                  <div className="mb-2 flex flex-col">
                    {orderedSidebarApps.map((app, i) => (
                      <SortableSidebarApp key={app.id} app={app} index={i} onOpen={() => setSidebarTab(`miniapp:${app.id}`)} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
          {filteredPanelApps.length > 0 && (
            <>
              <span className="px-1 py-1.5 text-xs font-medium text-sidebar-foreground/70">Apps</span>
              <div className="flex flex-col">
                {filteredPanelApps.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => {
                      window.miniapp.open(app.id, currentFolder ?? '')
                      openMiniAppTab(app.id, app.manifest.name)
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
                  >
                    <MiniAppIcon appId={app.id} className="size-7 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px]">{app.manifest.name}</span>
                      {app.manifest.description && <MarqueeText className="text-[11px] text-sidebar-foreground/50">{app.manifest.description}</MarqueeText>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {fullscreenApps.length > 0 && (
            <>
              <span className="px-1 py-1.5 text-xs font-medium text-sidebar-foreground/70">Fullscreen</span>
              <div className="flex flex-col">
                {fullscreenApps.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => {
                      setLayoutMode('canvas')
                      requestOpenInCanvas(app.id)
                    }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
                  >
                    <MiniAppIcon appId={app.id} className="size-7 shrink-0" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px]">{app.manifest.name}</span>
                      {app.manifest.description && <MarqueeText className="text-[11px] text-sidebar-foreground/50">{app.manifest.description}</MarqueeText>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {sidebarApps.length === 0 && filteredPanelApps.length === 0 && fullscreenApps.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-xs text-sidebar-foreground/70">
              <PackagePlus className="size-6 text-sidebar-foreground/30" />
              {appSearch ? 'No matching apps' : 'Drop .s1app file to install'}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
