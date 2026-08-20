import { useState, useCallback, type DragEvent } from 'react'
import { Maximize, PackagePlus, Search } from 'lucide-react'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { maximizeActivityPanel } from '@/components/activity/activity-panel-api'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@superone/ui/lib/utils'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { InstallPermissionDialog } from '@/components/miniapp/InstallPermissionDialog'

const S1APP_EXT = '.s1app'

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
  const apps = useMiniAppStore(useShallow((s) => s.apps))
  const openAppInPanel = useMiniAppStore((s) => s.openAppInPanel)
  const previewInstall = useMiniAppStore((s) => s.previewInstall)

  const [appSearch, setAppSearch] = useState('')
  const filteredApps = appSearch
    ? apps.filter((a) => a.manifest.name.toLowerCase().includes(appSearch.toLowerCase()))
    : apps

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
          installStatus.type === 'success' && 'bg-success/10 text-success',
          installStatus.type === 'error' && 'bg-error/10 text-error',
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
          {filteredApps.length > 0 ? (
            <div className="flex flex-col">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => {
                    openAppInPanel(app, currentFolder ?? '')
                  }}
                  className="group/app flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-hover"
                >
                  <MiniAppIcon appId={app.id} className="size-7 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px]">{app.manifest.name}</span>
                    {app.manifest.description && <MarqueeText className="text-[11px] text-sidebar-foreground/50">{app.manifest.description}</MarqueeText>}
                  </div>
                  <IconButton
                    size="sm"
                    variant="nested"
                    className="ml-1 opacity-0 transition-all group-hover/app:opacity-100"
                    onClick={async (e) => {
                      e.stopPropagation()
                      await openAppInPanel(app, currentFolder ?? '')
                      maximizeActivityPanel()
                    }}
                    tooltip="Open maximized"
                  >
                    <Maximize />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : (
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
