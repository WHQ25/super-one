import { useTranslation } from 'react-i18next'
import { AppWindow } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { useActivityPanelStore } from '@/stores/activity-panel'

export function ChatFloatDropOverlay() {
  const { t } = useTranslation()
  const preview = useActivityPanelStore((s) => s.floatDropPreview)
  const side = useActivityPanelStore((s) => s.side)

  if (!preview) return null

  return (
    <div
      data-chat-float-drop-overlay=""
      data-active={preview.active ? 'true' : 'false'}
      className={cn(
        'pointer-events-none absolute inset-y-0 z-40 flex w-2/3 items-center justify-center transition-opacity duration-150',
        side === 'left' ? 'right-0' : 'left-0',
      )}
    >
      <div
        className={cn(
          'relative flex h-full w-full flex-col items-center justify-center gap-2.5 overflow-hidden rounded-xl border-2 border-dashed bg-card/90 backdrop-blur-md transition-colors duration-150',
          preview.active
            ? 'border-primary text-primary shadow-lg'
            : 'border-muted-foreground/45 text-foreground shadow-sm',
        )}
      >
        {preview.active && <div className="pointer-events-none absolute inset-0 bg-primary/15" />}
        <AppWindow className="relative size-7 shrink-0" />
        <span className="relative px-4 text-center text-sm font-medium">
          {t(preview.active ? 'sidebar.contextMenu.releaseToFloatChat' : 'sidebar.contextMenu.dragToFloatChat')}
        </span>
      </div>
    </div>
  )
}
