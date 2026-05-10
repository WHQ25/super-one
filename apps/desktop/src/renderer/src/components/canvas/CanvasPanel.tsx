import { useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MiniAppSlot } from '@/components/miniapp/MiniAppSlot'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'

export const CanvasPanel = memo(function CanvasPanel() {
  const { t } = useTranslation()
  const apps = useMiniAppStore((s) => s.apps)
  const fullscreenApps = apps.filter((a) => a.manifest.fullscreen === true)
  const fetchApps = useMiniAppStore((s) => s.fetchApps)
  const openApp = useMiniAppStore((s) => s.fullscreenApp)
  const openFullscreenApp = useMiniAppStore((s) => s.openFullscreenApp)
  const currentFolder = useAppStore((s) => s.currentFolder)

  useEffect(() => {
    fetchApps(currentFolder ?? undefined)
  }, [fetchApps, currentFolder])

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
          <h1 className="text-4xl font-bold">{t('shell.startup.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('shell.startup.tagline')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <MiniAppSlot appId={openApp.appId} mode="canvas" className="h-full w-full" />
    </div>
  )
})
