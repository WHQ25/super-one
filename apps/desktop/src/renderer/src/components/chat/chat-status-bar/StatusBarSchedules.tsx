import { useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { SessionSchedule } from '@superone/shared/agent-types'

/** Claude's `/loop` with no prompt of its own fires a sentinel instead of user text. */
const AUTONOMOUS_LOOP_PROMPT = /^<<autonomous-loop(-dynamic)?>>$/

/** Timers that will wake this session (cron jobs, scheduled wakeups, `/loop`); hidden when none. */
export function StatusBarSchedules({ schedules }: { schedules: SessionSchedule[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (schedules.length === 0) return null

  const label = t('chat.schedules.title')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`${label} (${schedules.length})`} title={label}>
          <Clock data-icon="inline-start" />
          <span>{schedules.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96 max-w-[calc(100vw-2rem)] p-0" aria-label={label}>
        <div className="px-3 py-2 text-sm font-medium">{label} ({schedules.length})</div>
        <ul className="max-h-80 overflow-y-auto overscroll-contain">
          {schedules.map((schedule) => {
            const prompt = AUTONOMOUS_LOOP_PROMPT.test(schedule.prompt) ? t('chat.schedules.autonomousLoop') : schedule.prompt
            return (
              <li key={schedule.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <code className="truncate font-mono" title={schedule.schedule}>{schedule.schedule}</code>
                  <Badge variant="outline" className="shrink-0">
                    {schedule.recurring ? t('chat.schedules.recurring') : t('chat.schedules.once')}
                  </Badge>
                </div>
                <p className="line-clamp-3 break-words text-sm" title={prompt}>{prompt}</p>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
