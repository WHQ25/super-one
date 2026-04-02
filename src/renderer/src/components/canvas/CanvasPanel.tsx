import { useState, useEffect, useCallback } from 'react'
import { MiniAppFrame } from '@/components/miniapp/MiniAppFrame'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'
import { useAppStore } from '@/stores/app'
import { X } from 'lucide-react'
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

  useEffect(() => {
    window.miniapp.list().then(setApps).catch(console.error)
  }, [])

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

  if (openApps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <h2 className="text-lg font-medium">Mini-Apps</h2>
        {apps.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No apps installed. Add apps to ~/.superone/apps/
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {apps.map((app) => (
              <button
                key={app.id}
                onClick={() => openApp(app)}
                className="bg-card hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors"
              >
                <span className="text-sm font-medium">{app.manifest.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
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
      </div>
      <div className="relative flex-1">
        {openApps.map((app) => (
          <MiniAppFrame
            key={app.appId}
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
