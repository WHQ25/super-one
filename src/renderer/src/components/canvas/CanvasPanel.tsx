import { useEffect, useRef, memo } from 'react'
import { MiniAppView, type MiniAppViewHandle } from '@/components/miniapp/MiniAppView'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import { X } from 'lucide-react'

export const CanvasPanel = memo(function CanvasPanel() {
  const apps = useMiniAppStore((s) => s.apps)
  const fullscreenApps = apps.filter((a) => a.manifest.type === 'fullscreen')
  const fetchApps = useMiniAppStore((s) => s.fetchApps)
  const openApp = useMiniAppStore((s) => s.fullscreenApp)
  const openFullscreenApp = useMiniAppStore((s) => s.openFullscreenApp)
  const closeFullscreenApp = useMiniAppStore((s) => s.closeFullscreenApp)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const devFrameRef = useRef<MiniAppViewHandle>(null)

  useEffect(() => {
    fetchApps(currentFolder ?? undefined)
  }, [fetchApps, currentFolder])

  useEffect(() => {
    if (!openApp) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'r') {
        e.preventDefault()
        e.stopPropagation()
        devFrameRef.current?.reload()
      }
      if (isMod && e.shiftKey && e.key === 'i') {
        e.preventDefault()
        e.stopPropagation()
        devFrameRef.current?.openDevTools()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [openApp])

  const pendingOpenAppId = useMiniAppStore((s) => s.pendingOpenAppId)
  useEffect(() => {
    if (!pendingOpenAppId) return
    const entry = fullscreenApps.find((a) => a.id === pendingOpenAppId)
    if (!entry) return
    useMiniAppStore.getState().consumePendingOpen()
    openFullscreenApp(entry, currentFolder ?? '')
  }, [pendingOpenAppId, fullscreenApps, openFullscreenApp, currentFolder])

  if (!openApp) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold">SuperOne</h1>
          <p className="mt-2 text-muted-foreground">The one, the only!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <button
        onClick={closeFullscreenApp}
        className="absolute right-3 top-3 z-20 rounded-md bg-black/60 p-1 text-white/70 backdrop-blur-sm transition-opacity hover:text-white"
        title="Close"
      >
        <X className="size-4" />
      </button>
      <MiniAppView
        ref={devFrameRef}
        appId={openApp.appId}
        className="h-full w-full"
      />
    </div>
  )
})
