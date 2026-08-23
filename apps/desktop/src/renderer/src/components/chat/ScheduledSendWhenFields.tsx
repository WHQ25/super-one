import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, ChevronDown } from 'lucide-react'
import { Calendar } from '@superone/ui/components/ui/calendar'
import { cn } from '@superone/ui/lib/utils'
import { formatSendDay, toTimeInputValue, withDate, withTime } from './scheduled-send-time'

interface ScheduledSendWhenFieldsProps {
  /** The instant being edited, epoch ms. */
  value: number
  onChange: (next: number) => void
}

/**
 * Date and time editor for a scheduled send.
 *
 * The calendar unfolds *inside* the panel rather than in a popover of its own:
 * this whole panel is already a hover layer, and a nested one would let a click
 * meant for a day cell read as an outside-interaction that dismisses the parent.
 * Collapsed by default so the common case — nudging the time — stays one row.
 */
export function ScheduledSendWhenFields({ value, onChange }: ScheduledSendWhenFieldsProps) {
  const { t } = useTranslation()
  const [calendarOpen, setCalendarOpen] = useState(false)
  /**
   * The day the time field started from.
   *
   * A time input is segmented and emits a change per keystroke, so typing
   * `10:30` at 08:00 passes through `01:00` — already past, and rolled to
   * tomorrow. Anchoring every keystroke to the day editing began on stops that
   * transient roll from compounding: the finished `10:30` lands on today, where
   * it belongs.
   */
  const editAnchor = useRef<number | null>(null)

  // Today is offered only while the chosen time of day is still ahead of now;
  // otherwise picking it would produce an instant that is already due.
  const earliestDay = useMemo(() => {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    const todayAtChosenTime = new Date()
    const chosen = new Date(value)
    todayAtChosenTime.setHours(chosen.getHours(), chosen.getMinutes(), 0, 0)
    if (todayAtChosenTime.getTime() <= Date.now()) day.setDate(day.getDate() + 1)
    return day
  }, [value])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('chat.scheduledSend.date')}</span>
        <button
          type="button"
          onClick={() => setCalendarOpen((open) => !open)}
          aria-expanded={calendarOpen}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          {formatSendDay(value)}
          <ChevronDown
            className={cn('size-3 text-muted-foreground transition-transform', calendarOpen && 'rotate-180')}
          />
        </button>
      </div>

      {calendarOpen && (
        <Calendar
          mode="single"
          selected={new Date(value)}
          // Opens on the month being edited, not on today — the disclosure
          // remounts the calendar each time, so this re-anchors on every open.
          defaultMonth={new Date(value)}
          onSelect={(day) => {
            if (!day) return
            onChange(withDate(value, day))
            setCalendarOpen(false)
          }}
          // A past day cannot be scheduled — the row would be due the moment it
          // was written and would fire on the next poll.
          disabled={{ before: earliestDay }}
          className="w-full p-0"
          // shadcn's Calendar pins its root to `w-fit`; the columns already
          // stretch, so overriding just the root is what fills the panel.
          classNames={{ root: 'w-full' }}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('chat.scheduledSend.time')}</span>
        <input
          type="time"
          value={toTimeInputValue(value)}
          onFocus={() => { editAnchor.current = value }}
          onBlur={() => { editAnchor.current = null }}
          onChange={(e) => {
            const next = withTime(editAnchor.current ?? value, e.target.value, Date.now())
            if (next !== null) onChange(next)
          }}
          aria-label={t('chat.scheduledSend.time')}
          // `color-scheme` is the only lever over UA-drawn parts of a time input:
          // the picker glyph is a fixed dark SVG Chromium paints itself, invisible
          // on a dark field until the control is told it is dark. Scoped here
          // rather than set on `.dark` globally — that would also repaint every
          // scrollbar and native control in the app.
          className="h-7 rounded-md border border-border bg-transparent px-2 text-xs tabular-nums text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:[color-scheme:dark]"
        />
      </div>
    </div>
  )
}
