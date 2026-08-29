import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { buildRealtimeTimelineRows, formatTimelineOffset, type RealtimeTimelineRow } from './realtime-timeline-rows'

interface CodexRealtimeTimelineProps {
  segments: readonly RealtimeTimelineSegment[]
  /** Segments still being spoken, so the timeline can mark the live node. */
  speakingSegmentIds: ReadonlySet<string>
}

/** Codex is the only harness that runs realtime voice, so the label is not translated. */
const ASSISTANT_LABEL = 'Codex'

function CallHeader({ startedAtMs }: { startedAtMs: number | null }) {
  const { t } = useTranslation()
  if (startedAtMs === null) return null
  const time = new Date(startedAtMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mb-2 flex items-center gap-2 pl-[3.25rem] text-xs text-muted-foreground/80">
      <span>{t('chat.realtimeVoice.callStartedAt', { time })}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function SilenceMarker({ seconds }: { seconds: number }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[3rem_1rem_minmax(0,1fr)] items-center">
      <span />
      <span className="mx-auto h-4 w-px border-l border-dashed border-border" />
      <span className="pl-2 text-xs text-muted-foreground/70 tabular-nums">
        {t('chat.realtimeVoice.silence', { duration: formatTimelineOffset(seconds) })}
      </span>
    </div>
  )
}

function TimelineRow({ row, speaking, first, last }: {
  row: RealtimeTimelineRow
  speaking: boolean
  first: boolean
  last: boolean
}) {
  const { t } = useTranslation()
  const assistant = row.segment.role === 'assistant'
  return (
    <div className="grid grid-cols-[3rem_1rem_minmax(0,1fr)] items-start">
      <span className="pt-1.5 pr-2 text-right font-mono text-xs text-muted-foreground/80 tabular-nums">
        {row.offsetSeconds === null ? '' : formatTimelineOffset(row.offsetSeconds)}
      </span>

      {/* The rail is one continuous line broken only at the very start and end, so the
          eye reads a direction instead of a stack of separate cards. */}
      <span className="relative flex flex-col items-center self-stretch" aria-hidden>
        <span className={cn('h-3 w-px shrink-0', first ? 'bg-transparent' : 'bg-border')} />
        <span className={cn('w-px flex-1', last ? 'bg-transparent' : 'bg-border')} />
        <span
          className={cn(
            'absolute top-[9px] size-1.5 rounded-full ring-2 ring-background',
            speaking ? 'size-2 animate-pulse bg-primary' : assistant ? 'bg-primary/60' : 'bg-muted-foreground/50',
          )}
        />
      </span>

      <div className="mb-1.5 min-w-0 rounded-md border border-border/60 bg-card px-2.5 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {assistant ? ASSISTANT_LABEL : t('chat.realtimeVoice.speakerUser')}
          {speaking && <span className="ml-1.5 text-primary">{t('chat.realtimeVoice.speaking')}</span>}
        </span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{row.segment.text}</p>
      </div>
    </div>
  )
}

/**
 * Vertical voice timeline: time runs top to bottom on a single rail, each node carries
 * one utterance. Codex stamps nothing itself, so the scale comes from the start time
 * SuperOne recorded when the speaker opened the item — a segment without one keeps its
 * place in order but shows no tick.
 */
export function CodexRealtimeTimeline({ segments, speakingSegmentIds }: CodexRealtimeTimelineProps) {
  const rows = useMemo(() => buildRealtimeTimelineRows(segments), [segments])
  return (
    <div className="flex flex-col">
      {rows.map((row, index) => (
        <div key={row.segment.id}>
          {row.callStart && <CallHeader startedAtMs={row.callStartedAtMs} />}
          {row.silenceSeconds !== null && <SilenceMarker seconds={row.silenceSeconds} />}
          <TimelineRow
            row={row}
            speaking={speakingSegmentIds.has(row.segment.id)}
            first={index === 0}
            last={index === rows.length - 1}
          />
        </div>
      ))}
    </div>
  )
}
