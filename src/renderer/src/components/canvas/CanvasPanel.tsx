import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniAppDevFrame, type MiniAppDevFrameHandle } from '@/components/miniapp/MiniAppDevFrame'
import { MiniAppBuilder } from '@/components/canvas/MiniAppBuilder'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'
import { useAppStore } from '@/stores/app'
import { RotateCw, X, Bug } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OpenApp {
  appId: string
  entry: MiniAppEntry
}

export function CanvasPanel() {
  const [apps, setApps] = useState<MiniAppEntry[]>([])
  const [openApps, setOpenApps] = useState<OpenApp[]>([])
  const [activeAppId, setActiveAppId] = useState<string | null>(null)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const devFrameRefs = useRef<Map<string, MiniAppDevFrameHandle>>(new Map())

  const refreshApps = useCallback(() => {
    window.miniapp.list().then(setApps).catch(console.error)
  }, [])

  useEffect(() => {
    refreshApps()
  }, [refreshApps])

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
          <MiniAppDevFrame
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
