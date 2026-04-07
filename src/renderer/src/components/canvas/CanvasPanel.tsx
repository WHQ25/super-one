import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniAppView, type MiniAppViewHandle } from '@/components/miniapp/MiniAppView'
import { MiniAppBuilder } from '@/components/canvas/MiniAppBuilder'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { RotateCw, X, Bug } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OpenApp {
  appId: string
  entry: MiniAppEntry
}

export function CanvasPanel() {
  const apps = useMiniAppStore((s) => s.apps)
  const fetchApps = useMiniAppStore((s) => s.fetchApps)
  const [openApps, setOpenApps] = useState<OpenApp[]>([])
  const [activeAppId, setActiveAppId] = useState<string | null>(null)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const devFrameRefs = useRef<Map<string, MiniAppViewHandle>>(new Map())

  const refreshApps = useCallback(() => {
    useMiniAppStore.setState({ loaded: false })
    fetchApps(currentFolder ?? undefined)
  }, [fetchApps, currentFolder])

  useEffect(() => {
    fetchApps(currentFolder ?? undefined)
  }, [fetchApps, currentFolder])

  const openApp = useCallback(
    async (entry: MiniAppEntry) => {
      if (openApps.some((a) => a.appId === entry.id)) {
        setActiveAppId(entry.id)
        return
      }
      const projectDir = currentFolder ?? ''
      await window.miniapp.open(entry.id, projectDir)
      setOpenApps((prev) => [...prev, { appId: entry.id, entry }])
      setActiveAppId(entry.id)
    },
    [openApps, currentFolder],
  )

  const closeApp = useCallback(
    async (appId: string) => {
      await window.miniapp.close(appId)
      devFrameRefs.current.delete(appId)
      setOpenApps((prev) => {
        const next = prev.filter((a) => a.appId !== appId)
        if (activeAppId === appId) {
          setActiveAppId(next.length > 0 ? next[next.length - 1].appId : null)
        }
        return next
      })
    },
    [activeAppId],
  )

  const reloadActive = useCallback(() => {
    if (activeAppId) devFrameRefs.current.get(activeAppId)?.reload()
  }, [activeAppId])

  const openDevToolsActive = useCallback(() => {
    if (activeAppId) devFrameRefs.current.get(activeAppId)?.openDevTools()
  }, [activeAppId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeAppId) return
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'r') {
        e.preventDefault()
        e.stopPropagation()
        reloadActive()
      }
      if (isMod && e.shiftKey && e.key === 'i') {
        e.preventDefault()
        e.stopPropagation()
        openDevToolsActive()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeAppId, reloadActive, openDevToolsActive])

  const reloadOpenDevApps = useCallback(
    async (projectDir: string) => {
      const entries = await window.miniapp.detectDev(projectDir)
      for (const entry of entries) {
        setOpenApps((prev) => {
          const existing = prev.find((a) => a.appId === entry.id)
          if (existing) {
            devFrameRefs.current.get(entry.id)?.reload()
          }
          return prev
        })
      }
    },
    [],
  )

  useEffect(() => {
    const cleanup = window.miniapp.onDevAppReady((projectDir) => {
      if (projectDir === currentFolder) {
        reloadOpenDevApps(projectDir)
        refreshApps()
      }
    })
    return cleanup
  }, [currentFolder, reloadOpenDevApps, refreshApps])

  const pendingOpenAppId = useMiniAppStore((s) => s.pendingOpenAppId)
  useEffect(() => {
    if (!pendingOpenAppId) return
    const entry = apps.find((a) => a.id === pendingOpenAppId)
    if (!entry) return
    useMiniAppStore.getState().consumePendingOpen()
    openApp(entry)
  }, [pendingOpenAppId, apps, openApp])

  if (openApps.length === 0) {
    return <MiniAppBuilder apps={apps} onOpenApp={openApp} onRefresh={refreshApps} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {openApps.map((app) => (
          <button
            key={app.appId}
            onClick={() => setActiveAppId(app.appId)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
              activeAppId === app.appId
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <MiniAppIcon appId={app.appId} className="size-3.5" />
            <span>{app.entry.manifest.name}</span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation()
                closeApp(app.appId)
              }}
              className="hover:text-destructive ml-1 rounded-sm p-0.5"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={reloadActive}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            title="Reload (Cmd+R)"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={openDevToolsActive}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            title="DevTools (Cmd+Shift+I)"
          >
            <Bug className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        {openApps.map((app) => (
          <MiniAppView
            key={app.appId}
            ref={(handle) => {
              if (handle) devFrameRefs.current.set(app.appId, handle)
              else devFrameRefs.current.delete(app.appId)
            }}
            appId={app.appId}
            className={cn(
              'absolute inset-0',
              activeAppId !== app.appId && 'invisible',
            )}
          />
        ))}
      </div>
    </div>
  )
}
