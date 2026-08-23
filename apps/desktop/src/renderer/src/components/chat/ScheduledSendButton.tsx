import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Clock } from 'lucide-react'
import { SCHEDULED_SEND_DEFAULT_MESSAGE, type ScheduledSend } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { formatSendWhen, nextOccurrenceOf } from './scheduled-send-time'
import { ScheduledSendWhenFields } from './ScheduledSendWhenFields'
import { HoverCloseSlot } from '@/components/activity/ActivityTab'

/**
 * The instant to actually arm, given the one on screen.
 *
 * A hand-picked time can only mean the future, so one that has slipped behind
 * rolls to its next occurrence rather than arming a row that is due on arrival
 * and fires on the very next poll.
 *
 * A rate-limit offer is the exception and arms exactly as it stands. Its time is
 * not a plan, it is a gate: "when the quota reopens". Coming back to that offer
 * after the reset has already passed means the gate is open now, and rolling it
 * to tomorrow would make the user wait out a window that is no longer closed.
 */
function armableSendAt(sendAt: number, scheduled: ScheduledSend | null): number {
  if (scheduled?.source === 'rate_limit') return sendAt
  return nextOccurrenceOf(sendAt, Date.now())
}

/** Geometry both chip states share, so the swap between them never jumps. */
const chipClass = 'inline-flex h-7 items-center gap-1.5 rounded-full border pl-2 pr-2.5 text-xs font-medium'

/** The label unrolling out of the circle rather than appearing beside it. */
function ChipLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid animate-[scheduled-send-unroll_360ms_cubic-bezier(0.32,0.72,0,1)_both] grid-cols-[1fr]">
      <span className="min-w-0 overflow-hidden whitespace-nowrap">{children}</span>
    </span>
  )
}

/** Where the time field starts when nothing has proposed one. */
const DEFAULT_LEAD_MS = 60 * 60 * 1000
/** Grace on pointer-out, so a pointer between the two hover regions is not a leave. */
const CLOSE_DELAY_MS = 220
/** Gap between chip and panel. Kept in step with the `after` bridge that spans it. */
const SIDE_OFFSET = 8

interface ScheduledSendButtonProps {
  /** The session's queued send, or null when nothing is queued. */
  scheduled: ScheduledSend | null
  /** Whether an immediate send is possible right now (composer has content, etc). */
  canSend: boolean
  /**
   * Whether there is anything to schedule.
   *
   * False only for a session that has never been sent in and whose composer is
   * empty: the default message means "carry on with what we were doing", and in
   * a conversation that has not started there is nothing to carry on from.
   */
  canArm: boolean
  onSendNow: () => void
  /** Arm using whatever is in the composer, due at `sendAt`. */
  onArm: (sendAt: number) => void
  /** Cancel the schedule and hand the queued text back to the composer. */
  onDisarm: () => void
  /** Re-time a queued send that already exists. */
  onSetSendAt: (sendAt: number) => void
}

/**
 * The composer's send control, which is always a scheduled-send control.
 *
 * Nothing queued and it is the ordinary arrow. Queue something — by hand from
 * the popover, or by accepting the offer a rate limit pre-fills — and the label
 * unrolls out of the circle rather than appearing beside it, so the button that
 * grew the schedule is visibly the one that still owns it. The prompt itself
 * always comes from the composer; this control owns no text field.
 */
export function ScheduledSendButton({
  scheduled,
  canSend,
  canArm,
  onSendNow,
  onArm,
  onDisarm,
  onSetSendAt,
}: ScheduledSendButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Set once the pointer or focus lands *inside* the panel. Hover alone is too
   * fragile to hold a panel that contains a time field: the native picker draws
   * outside the document, and any boundary event the browser decides to fire
   * mid-edit would yank the panel away under the user. After a real interaction
   * only Escape or a click outside closes it. A ref, not state — the pending
   * close timer has to read the current value, not the one it closed over.
   */
  const latched = useRef(false)
  // A time the user picked before any row existed — held here until the toggle
  // commits it, so opening the popover never writes to main by itself.
  const [draftSendAt, setDraftSendAt] = useState<number | null>(null)
  // Held in state rather than read during render, which would slide the field
  // out from under the user on every unrelated re-render — but refreshed when
  // the panel opens, because a composer can sit untouched for hours and a
  // default from mount would arm a send that is already due.
  const [fallbackSendAt, setFallbackSendAt] = useState(() => Date.now() + DEFAULT_LEAD_MS)

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])

  const hoverIn = useCallback(() => {
    cancelClose()
    // Both held times can have gone stale while the composer sat untouched, and
    // the panel must never *show* an instant that has already passed — arming
    // what is on screen is the one thing the user is about to do.
    setFallbackSendAt((prev) => (prev > Date.now() ? prev : Date.now() + DEFAULT_LEAD_MS))
    setDraftSendAt((prev) => (prev === null ? null : nextOccurrenceOf(prev, Date.now())))
    setOpen(true)
  }, [cancelClose])

  const hoverOut = useCallback(() => {
    cancelClose()
    if (latched.current) return
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  /** Pin the panel open — the user is working in it, not passing over it. */
  const latch = useCallback(() => {
    cancelClose()
    latched.current = true
  }, [cancelClose])

  const dismiss = useCallback(() => {
    cancelClose()
    latched.current = false
    setOpen(false)
  }, [cancelClose])

  const armed = scheduled?.armed ?? false
  const sendAt = scheduled?.sendAt ?? draftSendAt ?? fallbackSendAt
  const time = formatSendWhen(sendAt, Date.now())

  const handleWhenChange = useCallback(
    (next: number) => {
      setDraftSendAt(next)
      // Nothing queued yet means there is no row to amend — the picked instant
      // waits here until the toggle commits it.
      if (scheduled) onSetSendAt(next)
    },
    [onSetSendAt, scheduled],
  )

  const handleToggle = useCallback(
    (next: boolean) => {
      if (!next) { onDisarm(); return }
      if (!canArm) return
      onArm(armableSendAt(sendAt, scheduled))
    },
    [canArm, onArm, onDisarm, scheduled, sendAt],
  )

  // Only the two non-destructive states reach this: accepting an offer, and an
  // ordinary send. Cancelling has its own target inside the armed chip.
  const handlePrimary = useCallback(() => {
    if (scheduled) onArm(armableSendAt(scheduled.sendAt, scheduled))
    else onSendNow()
  }, [onArm, onSendNow, scheduled])

  // Unarmed is a question the user has not answered yet, so it asks rather than
  // states — and asks about the event ("on reset") rather than a clock time they
  // have not agreed to. Once armed the source stops mattering: whatever put the
  // row there, what is true now is that something goes out at that time.
  const label = !scheduled
    ? null
    : armed
      ? t('chat.scheduledSend.sendAt', { time })
      : t('chat.scheduledSend.continueOnReset')

  const primaryLabel = armed
    ? t('chat.scheduledSend.cancel')
    : scheduled
      ? t('chat.scheduledSend.accept', { time })
      : t('chat.scheduledSend.sendNow')

  return (
    // Anchor, not Trigger: `PopoverTrigger` composes an open-toggle into the
    // click handler of whatever it wraps, so every press of the send button
    // would also flip this panel — and it would put dialog ARIA on a plain div.
    <Popover open={open} onOpenChange={(next) => { if (!next) dismiss() }}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          data-testid="scheduled-send"
          data-state={armed ? 'armed' : scheduled ? 'offered' : 'idle'}
          onPointerEnter={hoverIn}
          onPointerLeave={hoverOut}
          className="inline-flex items-center"
        >
          {scheduled ? (
            armed ? (
              // Not a button. An armed schedule is a state the user set on
              // purpose, and cancelling it is destructive — putting that on the
              // whole chip means every stray click on a label they were only
              // reading throws the promise away. The clock slot is the one
              // target, and it says so by growing a fill under the pointer.
              <div className={cn(chipClass, 'border-warning/60 bg-warning/15 text-warning')}>
                <HoverCloseSlot onClose={onDisarm} label={primaryLabel}>
                  <Clock className="size-3.5 shrink-0" />
                </HoverCloseSlot>
                <ChipLabel>{label}</ChipLabel>
              </div>
            ) : (
              // Unanswered, so the whole chip is the answer: it asks a question
              // and clicking anywhere on it says yes, which is additive and
              // undoable by the armed state's own X.
              <button
                type="button"
                onClick={handlePrimary}
                aria-label={primaryLabel}
                className={cn(
                  chipClass,
                  'cursor-pointer border-warning/40 bg-warning/8 text-warning/90 transition-colors hover:bg-warning/15 hover:text-warning',
                )}
              >
                <Clock className="size-3.5 shrink-0" />
                <ChipLabel>{label}</ChipLabel>
              </button>
            )
          ) : (
            <IconButton
              variant="ghost"
              onClick={handlePrimary}
              disabled={!canSend}
              aria-label={primaryLabel}
              className="size-7 rounded-full border border-border disabled:opacity-30"
            >
              <ArrowUp />
            </IconButton>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        side="top"
        // Standing off the chip so the panel reads as its own surface rather
        // than a taller button. The gap is only visual: the `after` strip below
        // spans it as part of this element's box, so the pointer crossing it
        // never leaves the panel and there is no dead zone to fall into.
        sideOffset={SIDE_OFFSET}
        className="w-64 p-3 after:absolute after:inset-x-0 after:top-full after:h-2 after:content-['']"
        // Hovering must never pull focus out of the composer mid-sentence.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onPointerDownCapture={latch}
        onFocusCapture={latch}
        // The anchor is not "outside" — pressing the send button under an open
        // panel must run its own handler, not be eaten as a dismiss.
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">{t('chat.scheduledSend.toggle')}</span>
          <Switch
            checked={armed}
            disabled={!armed && !canArm}
            onCheckedChange={handleToggle}
            aria-label={t('chat.scheduledSend.toggle')}
          />
        </div>
        <div className="mt-3">
          <ScheduledSendWhenFields value={sendAt} onChange={handleWhenChange} />
        </div>
        <div className="mt-3 space-y-1.5">
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {armed
              ? t('chat.scheduledSend.queued', {
                  message: scheduled?.message?.trim() || SCHEDULED_SEND_DEFAULT_MESSAGE,
                })
              : scheduled?.source === 'rate_limit'
                ? t('chat.scheduledSend.hintRateLimit', { time })
                : canArm
                  ? t('chat.scheduledSend.hintIdle')
                  : t('chat.scheduledSend.hintNeedsDraft')}
          </p>
          {/* The pill asks a question but cannot say what answering yes does —
              it has room for the question only. The panel is where that lands. */}
          {scheduled && !armed && (
            <p className="text-xs text-muted-foreground/80">
              {t('chat.scheduledSend.explainOffer', { fallback: SCHEDULED_SEND_DEFAULT_MESSAGE })}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
