import { useEffect, useRef, type CSSProperties } from 'react'
import { AudioLines } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CodexCloudMark, CodexCloudOutline } from '@superone/ui/components/harness/CodexSessionIcon'
import { cn } from '@superone/ui/lib/utils'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useRealtimeCallStore, type RealtimeCallState } from '@/stores/realtime-call'

const MARK_SIZE = 84
const GLYPH_SIZE = 30
const NO_LIVE_ITEMS: never[] = []

/** Matches the cloud, so the three columns share one baseline box. */
const CAPTION_BOX: CSSProperties = { height: MARK_SIZE }

/**
 * One side's live caption: cloud-height, vertically centred while it fits, and
 * scrolled once it does not.
 *
 * The inner `min-h-full` wrapper is what makes those two behaviours coexist. Putting
 * `items-center` straight on the scroll container is the obvious version and it is
 * broken: an overflowing item gets centred past the scroll origin, and since
 * `scrollTop` cannot go negative the first lines become permanently unreachable.
 * Here the wrapper only stretches to the container while the text is short — once the
 * text is taller, centring has nothing left to distribute and scrolling is ordinary.
 */
function CaptionColumn({
  text,
  side,
  testId,
}: {
  text: string
  /** Which side of the cloud this column sits on; the text aligns toward the cloud. */
  side: 'left' | 'right'
  testId: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)

  // A caption is a live utterance: the newest words matter, not the opening ones.
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [text])

  return (
    <div
      ref={viewportRef}
      data-testid={testId}
      aria-live="polite"
      style={CAPTION_BOX}
      className="min-w-0 flex-1 overflow-y-auto"
    >
      <div className="flex min-h-full items-center">
        <p
          className={cn(
            'w-full break-words text-xs leading-snug',
            side === 'left' ? 'text-right text-muted-foreground' : 'text-left text-foreground',
          )}
        >
          {text}
        </p>
      </div>
    </div>
  )
}

/**
 * Persistent "a voice call is running" marker above the composer.
 *
 * Purely a status surface — the voice mark reflects listening, speech, and thinking,
 * with live captions flanking it by speaker. Every control over the call lives in the
 * composer toolbar beside the session's other actions, rather than hiding behind a
 * hover on this one.
 */
interface RealtimeCallIndicatorProps {
  /**
   * Render as if the call were in this state once the store has gone idle. The
   * voice composer uses it to keep the mark on screen while it slides out after
   * a hang-up, instead of vanishing a frame before its exit animation starts.
   */
  frozenState?: RealtimeCallState
}

export function RealtimeCallIndicator({ frozenState }: RealtimeCallIndicatorProps = {}) {
  const { t } = useTranslation()
  const liveState = useRealtimeCallStore((store) => store.state)
  const state = liveState === 'idle' && frozenState ? frozenState : liveState
  const sessionId = useRealtimeCallStore((store) => store.sessionId)
  const activity = useRealtimeCallStore((store) => store.activity)
  const inputLevel = useRealtimeCallStore((store) => store.inputLevel)
  const liveItems = useCodexRealtimeViewStore((store) => (
    sessionId ? store.sessions[sessionId]?.liveItems ?? NO_LIVE_ITEMS : NO_LIVE_ITEMS
  ))

  if (state === 'idle') return null
  // One mark, one place, from the first click: while the offer is out it breathes
  // in the same spot it will listen from, so nothing jumps when the answer lands.
  const connecting = state === 'starting'

  const pending = liveItems.filter((item) => !item.done && item.text.trim().length > 0)
  const assistantCaption = pending.findLast((item) => item.role === 'assistant')?.text ?? ''
  const userCaption = pending.findLast((item) => item.role === 'user')?.text ?? ''

  return (
    <div
      data-testid="realtime-call-indicator"
      aria-label={t(connecting ? 'chat.realtimeVoice.connecting' : 'chat.realtimeVoice.listening')}
      className="flex w-full items-center justify-center gap-3 px-2 pt-2"
    >
      <CaptionColumn text={assistantCaption} side="left" testId="realtime-caption-assistant" />
      <span
        data-testid="realtime-voice-mark"
        data-activity={connecting ? 'connecting' : activity}
        className="realtime-voice-mark shrink-0 text-primary"
        style={{ '--voice-level': inputLevel } as CSSProperties}
      >
        <span className="realtime-voice-halo" aria-hidden>
          <CodexCloudOutline size={MARK_SIZE} className="realtime-voice-halo-outline" />
          <CodexCloudOutline
            size={MARK_SIZE}
            className="realtime-voice-halo-outline realtime-voice-halo-wave"
          />
          <CodexCloudOutline
            size={MARK_SIZE}
            className="realtime-voice-halo-outline realtime-voice-halo-wave"
          />
        </span>
        <span className="realtime-voice-mark-shell">
          <CodexCloudMark size={MARK_SIZE} motion={connecting ? 'pulse' : 'still'}>
            <AudioLines
              className="text-white"
              strokeWidth={2}
              style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
              aria-hidden
            />
          </CodexCloudMark>
        </span>
      </span>
      <CaptionColumn text={userCaption} side="right" testId="realtime-caption-user" />
    </div>
  )
}
