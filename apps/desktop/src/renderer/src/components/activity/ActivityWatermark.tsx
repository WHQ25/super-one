import { FileX2, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openBrowserTab } from './activity-panel-api'

export function ActivityWatermark() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileX2 className="size-8 opacity-30" />
      <span className="text-xs">No panels open</span>
      <button
        onClick={() => openBrowserTab()}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground"
      >
        <Globe className="size-3.5" />
        <span>{t('tooltips.newBrowserTab')}</span>
      </button>
    </div>
  )
}
