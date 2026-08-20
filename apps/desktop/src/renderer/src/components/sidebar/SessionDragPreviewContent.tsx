import { useTranslation } from 'react-i18next'
import { MessageSquare, PictureInPicture2 } from 'lucide-react'

export function DragPreviewPill({ title }: { title: string }) {
  return (
    <div className="session-drag-chip flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[13px] text-sidebar-foreground shadow-lg">
      <MessageSquare className="size-3 shrink-0 text-sidebar-foreground/70" />
      <span className="max-w-[200px] truncate">{title}</span>
    </div>
  )
}

export function DragPreviewCard({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <div className="session-drag-chip w-[180px] overflow-hidden rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-sidebar-border/60 bg-sidebar-hover px-2.5 py-1.5">
        <span className="size-2 rounded-full bg-red-400" />
        <span className="size-2 rounded-full bg-yellow-400" />
        <span className="size-2 rounded-full bg-green-400" />
        <span className="ml-1 truncate text-[11px] text-sidebar-foreground/70">{title}</span>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-5 text-center text-sidebar-foreground">
        <PictureInPicture2 className="size-7 shrink-0 text-sidebar-foreground/70" />
        <span className="text-[12px] leading-snug">{t('sidebar.contextMenu.dragToMiniWindow')}</span>
      </div>
    </div>
  )
}
