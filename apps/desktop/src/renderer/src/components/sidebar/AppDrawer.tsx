import { useState, useCallback, useMemo, useEffect, type DragEvent } from 'react'
import { Blocks, ChevronDown, ChevronRight, Maximize, PackagePlus, Plus, Store } from 'lucide-react'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { useChatStore } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@superone/ui/lib/utils'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import { InstallPermissionDialog } from '@/components/miniapp/InstallPermissionDialog'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { AnimatePresence, motion } from 'motion/react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const S1APP_EXT = '.s1app'
const MAX_STACKED_ICONS = 10

function isS1AppFile(e: DragEvent): boolean {
  for (let i = 0; i < e.dataTransfer.items.length; i++) {
    if (e.dataTransfer.items[i].kind === 'file') return true
  }
  return false
}

function getS1AppPaths(e: DragEvent): string[] {
  const paths: string[] = []
  for (let i = 0; i < e.dataTransfer.files.length; i++) {
    const path = window.app.getPathForFile(e.dataTransfer.files[i])
    if (path.endsWith(S1APP_EXT)) paths.push(path)
  }
  return paths
}

function SortableAppRow({ app, index, onClick, onOpenFullscreen }: { app: MiniAppEntry; index: number; onClick: () => void; onOpenFullscreen?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })
  const style = { transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }
  const [hovered, setHovered] = useState(false)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group/sapp flex cursor-grab items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent active:cursor-grabbing',
        isDragging && 'z-10 opacity-80 shadow-sm',
      )}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MiniAppIcon appId={app.id} className="size-6 shrink-0" />
      <div className="flex w-0 flex-1 flex-col overflow-hidden">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="truncate">{app.manifest.name}</span>
          {app.manifest.isDev && <span className="inline-flex h-4 shrink-0 items-center rounded bg-orange-500/15 px-1 text-[10px] leading-none text-orange-500">Dev</span>}
          {index <= 9 && <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[10px] leading-none text-sidebar-foreground/60">{index < 9 ? index + 1 : 0}</span>}
        </span>
        {app.manifest.description && (
          <MarqueeText className="text-[11px] text-sidebar-foreground/50" hovered={hovered}>{app.manifest.description}</MarqueeText>
        )}
      </div>
      {onOpenFullscreen && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpenFullscreen()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-1 shrink-0 rounded p-1 text-sidebar-foreground/40 opacity-0 transition-opacity hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground/80 group-hover/sapp:opacity-100"
          title="Open in canvas"
        >
          <Maximize className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function AppDrawer() {
  const [expanded, setExpanded] = useState(false)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const setLayoutMode = useAppStore((s) => s.setLayoutMode)

  const refreshApps = useMiniAppStore((s) => s.refreshApps)
  const allApps = useMiniAppStore(useShallow((s) => s.apps))
  const requestOpenInCanvas = useMiniAppStore((s) => s.requestOpenInCanvas)
  const openAppInPanel = useMiniAppStore((s) => s.openAppInPanel)
  const previewInstall = useMiniAppStore((s) => s.previewInstall)
  const setDraftText = useChatStore((s) => s.setDraftText)

  useEffect(() => {
    if (expanded) refreshApps(currentFolder ?? undefined)
  }, [expanded, refreshApps, currentFolder])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const totalApps = allApps.length
  const stackedApps = allApps.slice(0, MAX_STACKED_ICONS)

  const [appOrder, setAppOrder] = useState<string[]>([])
  const orderedApps = useMemo(() => {
    if (appOrder.length === 0) return allApps
    const orderMap = new Map(appOrder.map((id, i) => [id, i]))
    return [...allApps].sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity))
  }, [allApps, appOrder])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = orderedApps.map((a) => a.id)
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    setAppOrder(arrayMove(ids, oldIdx, newIdx))
  }, [orderedApps])

  const openApp = useCallback((app: MiniAppEntry) => {
    setExpanded(false)
    openAppInPanel(app, currentFolder ?? '')
  }, [currentFolder, openAppInPanel])

  const openAppFullscreen = useCallback((app: MiniAppEntry) => {
    setExpanded(false)
    setLayoutMode('canvas')
    requestOpenInCanvas(app.id)
  }, [setLayoutMode, requestOpenInCanvas])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      if (e.key === '3') {
        e.preventDefault()
        setExpanded((v) => !v)
        return
      }
      if (!expanded) return
      const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key) : e.key === '0' ? 10 : -1
      if (digit < 0) return
      const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA'
      if (isInput) return
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const handler = (e: KeyboardEvent) => {
      const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA'
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || isInput) return
      const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key) - 1 : e.key === '0' ? 9 : -1
      if (digit < 0 || digit >= orderedApps.length) return
      e.preventDefault()
      openApp(orderedApps[digit])
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded, orderedApps, openApp])

  const [isDragOver, setIsDragOver] = useState(false)
  const [installStatus, setInstallStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleFileDragOver = useCallback((e: DragEvent) => {
    if (!expanded) return
    e.preventDefault()
    e.stopPropagation()
    if (isS1AppFile(e)) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [expanded])

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

  const handleBuildApp = useCallback(() => {
    setDraftText('Help me build a mini app for SuperOne. Guide me through the process step by step.')
  }, [setDraftText])

  return (
    <div
      className="mx-2 mt-1 mb-1 shrink-0"
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <InstallPermissionDialog onInstalled={handleInstalled} onError={handleInstallError} />
      <div className="overflow-hidden rounded-lg border border-sidebar-border">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-[30px] w-full cursor-pointer items-center justify-between px-2.5 py-1 transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex items-center gap-2">
            {expanded || totalApps === 0 ? (
              <>
                <Blocks className="size-3.5 text-sidebar-foreground/50" />
                <span className="text-xs text-sidebar-foreground/50">Apps</span>
              </>
            ) : (
              <>
                <div className="flex items-center">
                  {stackedApps.map((app, i) => (
                    <div key={app.id} className={cn('shrink-0 rounded-[6px] ring-1 ring-sidebar', i > 0 && '-ml-[6px]')} style={{ zIndex: i }}>
                      <MiniAppIcon appId={app.id} className="size-[22px] rounded-[5px]" />
                    </div>
                  ))}
                </div>
                <span className="text-xs text-sidebar-foreground/50">
                  {totalApps} App{totalApps > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          {expanded
            ? <ChevronDown className="size-3.5 text-sidebar-foreground/50" />
            : <ChevronRight className="size-3.5 text-sidebar-foreground/50" />
          }
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="relative">
                {isDragOver && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-orange-600/60 dark:border-orange-400/60 bg-orange-50/50 dark:bg-orange-950/20">
                    <PackagePlus className="mb-2 size-8 text-orange-500/70" />
                    <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Drop .s1app to install</span>
                  </div>
                )}

                {installStatus && (
                  <div className={cn(
                    'mx-2 mb-1 rounded-md px-2.5 py-1.5 text-xs',
                    installStatus.type === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    installStatus.type === 'error' && 'bg-red-500/10 text-red-600 dark:text-red-400',
                  )}>
                    {installStatus.message}
                  </div>
                )}

                <ScrollArea className="max-h-96">
                  <div className="px-1 py-1">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={orderedApps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                        {orderedApps.map((app, i) => (
                          <SortableAppRow
                            key={app.id}
                            app={app}
                            index={i}
                            onClick={() => openApp(app)}
                            onOpenFullscreen={app.manifest.fullscreen ? () => openAppFullscreen(app) : undefined}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>
                </ScrollArea>

                <div className="flex gap-1 px-1 pb-1">
                  <button
                    className="mt-0.5 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
                  >
                    <Store className="size-3" />
                    Marketplace
                  </button>
                  <button
                    onClick={handleBuildApp}
                    className="mt-0.5 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
                  >
                    <Plus className="size-3" />
                    Build Your Own
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
