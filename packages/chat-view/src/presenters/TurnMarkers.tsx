import { Check, ScanSearch, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ContentBlock } from '@superone/shared/agent-types'

/** Review mode entered (with its target) or finished. */
export function ReviewMarkerPresenter({ block }: { block: Extract<ContentBlock, { type: 'review' }> }) {
  const { t } = useTranslation()
  return block.phase === 'entered' ? (
    <div className="my-1 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
      <ScanSearch className="size-3.5 shrink-0" />
      <span className="min-w-0 font-medium">{t('chat.turnMarker.reviewStarted')}{block.text ? ` — ${block.text}` : ''}</span>
    </div>
  ) : (
    <div className="my-1 flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-1.5 text-xs text-success">
      <Check className="size-3.5 shrink-0" />
      <span className="font-medium">{t('chat.turnMarker.reviewComplete')}</span>
    </div>
  )
}

/** A notice the turn continued past: an error, or the context being compacted. */
export function TurnNoticePresenter({ block }: { block: Extract<ContentBlock, { type: 'notice' }> }) {
  const { t } = useTranslation()
  if (block.kind === 'omitted') {
    return <div className="my-0.5 text-xs text-muted-foreground" data-testid="window-omitted">{t('chat.transcriptWindow.omitted')}</div>
  }
  if (block.kind === 'compaction') {
    return (
      <div className="my-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 text-success" />
        <span>{t('chat.turnMarker.compacted')}</span>
      </div>
    )
  }
  if (block.level === 'error') {
    return (
      <div className="my-0.5 rounded bg-error/10 px-2 py-1.5">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-error">
          <TriangleAlert className="size-3.5" />
          <span>{t('chat.turnMarker.error')}</span>
        </div>
        <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{block.text}</div>
      </div>
    )
  }
  return <div className="my-0.5 text-xs text-muted-foreground">{block.text}</div>
}
