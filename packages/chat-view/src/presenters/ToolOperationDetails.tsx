import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/** Shared Bash edit / Codex exploration layout: one Command section, followed by file rows. */
export function ToolOperationDetails({ outputOpen, onOutputOpenChange, outputPanel, children, note }: {
  outputOpen: boolean
  onOutputOpenChange: (open: boolean) => void
  outputPanel: ReactNode
  children: ReactNode
  note?: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="cursor-default space-y-0.5 border-t border-border/30 px-1.5 py-1">
      <button type="button" className="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40"
        aria-expanded={outputOpen} onClick={() => onOutputOpenChange(!outputOpen)}>
        <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', outputOpen && 'rotate-90')} />
        <span>{t('chat.toolBlock.commandPanel')}</span>
      </button>
      {outputOpen && outputPanel}
      <div className="max-h-96 space-y-0.5 overflow-y-auto">{children}</div>
      {note && <div className="px-2 py-0.5 text-xs text-muted-foreground/70">{note}</div>}
    </div>
  )
}
