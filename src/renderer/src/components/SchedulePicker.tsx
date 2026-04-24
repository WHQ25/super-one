import { useState, useMemo } from 'react'
import { CalendarIcon, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { Cron } from 'croner'
import { useTranslation } from 'react-i18next'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { AutomationSchedule } from '../../../shared/agent-types'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]

type SchedulePreset = 'once' | 'hourly' | 'daily' | 'weekly'

function buildCron(preset: SchedulePreset, timeOfDay?: string, dayOfWeek?: number[], minuteOfHour?: number): string | undefined {
  const [hour, min] = (timeOfDay ?? '09:00').split(':').map(Number)
  switch (preset) {
    case 'hourly':
      return `${minuteOfHour ?? 0} * * * *`
    case 'daily':
      return `${min} ${hour} * * *`
    case 'weekly': {
      const days = dayOfWeek?.length ? dayOfWeek.join(',') : '1'
      return `${min} ${hour} * * ${days}`
    }
    default:
      return undefined
  }
}

function getNextRuns(cron: string, count = 3): Date[] {
  try {
    const job = new Cron(cron)
    const runs: Date[] = []
    let d: Date | null = null
    for (let i = 0; i < count; i++) {
      d = job.nextRun(d ?? undefined)
      if (!d) break
      runs.push(d)
      d = new Date(d.getTime() + 1000)
    }
    return runs
  } catch {
    return []
  }
}

function formatNextRun(d: Date): string {
  return format(d, 'MMM d HH:mm')
}

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d:]/g, '')
    if (raw.length <= 5) {
      onChange(raw)
    }
  }

  const handleBlur = () => {
    const parts = (value || '09:00').split(':')
    const h = Math.min(23, Math.max(0, parseInt(parts[0]) || 0))
    const m = Math.min(59, Math.max(0, parseInt(parts[1]) || 0))
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-1">
      <Clock className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="text"
        inputMode="numeric"
        value={value || '09:00'}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="HH:MM"
        className="w-16 rounded-md border border-border bg-background px-2 py-1 text-center text-xs outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}

export function SchedulePicker({
  value,
  onChange,
}: {
  value: AutomationSchedule
  onChange: (schedule: AutomationSchedule) => void
}) {
  const { t } = useTranslation()
  const [advanced, setAdvanced] = useState(value.preset === 'custom')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const preset: SchedulePreset = (value.preset as SchedulePreset) ?? (value.type === 'one-time' ? 'once' : 'daily')

  const selectedDate = useMemo(() => {
    if (value.runAt) return new Date(value.runAt)
    return undefined
  }, [value.runAt])

  const nextRuns = useMemo(() => {
    if (value.type === 'one-time' && value.runAt) {
      const d = new Date(value.runAt)
      return d > new Date() ? [d] : []
    }
    if (value.cron) return getNextRuns(value.cron)
    return []
  }, [value.cron, value.runAt, value.type])

  const setPreset = (p: SchedulePreset) => {
    if (p === 'once') {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      onChange({
        type: 'one-time',
        preset: undefined,
        runAt: tomorrow.toISOString(),
        timeOfDay: '09:00',
      })
    } else {
      const cron = buildCron(p, value.timeOfDay ?? '09:00', value.dayOfWeek ?? [1], value.minuteOfHour ?? 0)
      onChange({
        type: 'recurring',
        preset: p,
        cron,
        timeOfDay: value.timeOfDay ?? '09:00',
        dayOfWeek: p === 'weekly' ? (value.dayOfWeek?.length ? value.dayOfWeek : [1]) : undefined,
        minuteOfHour: p === 'hourly' ? (value.minuteOfHour ?? 0) : undefined,
      })
    }
    setAdvanced(false)
  }

  const updateTime = (time: string) => {
    if (preset === 'once' && value.runAt) {
      const d = new Date(value.runAt)
      const [hh, mm] = time.split(':').map(Number)
      d.setHours(hh, mm, 0, 0)
      onChange({ ...value, timeOfDay: time, runAt: d.toISOString() })
    } else {
      const cron = buildCron(preset, time, value.dayOfWeek, value.minuteOfHour)
      onChange({ ...value, timeOfDay: time, cron })
    }
  }

  const updateDate = (date: Date | undefined) => {
    if (!date) return
    const [hh, mm] = (value.timeOfDay ?? '09:00').split(':').map(Number)
    const d = new Date(date)
    d.setHours(hh, mm, 0, 0)
    onChange({ ...value, type: 'one-time', runAt: d.toISOString() })
    setCalendarOpen(false)
  }

  const toggleDay = (day: number) => {
    const current = value.dayOfWeek ?? []
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    if (next.length === 0) return
    const cron = buildCron('weekly', value.timeOfDay, next, value.minuteOfHour)
    onChange({ ...value, dayOfWeek: next, cron })
  }

  const updateMinute = (min: number) => {
    const clamped = Math.max(0, Math.min(59, min))
    const cron = buildCron('hourly', value.timeOfDay, value.dayOfWeek, clamped)
    onChange({ ...value, minuteOfHour: clamped, cron })
  }

  const updateCron = (cronStr: string) => {
    onChange({ ...value, type: 'recurring', preset: 'custom', cron: cronStr })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('resources.schedule.label')}</span>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline"
          onClick={() => {
            if (!advanced) {
              setAdvanced(true)
              if (value.preset !== 'custom' && value.cron) {
                onChange({ ...value, preset: 'custom' })
              }
            } else {
              setAdvanced(false)
            }
          }}
        >
          {advanced ? t('resources.schedule.simple') : t('resources.schedule.advanced')}
        </button>
      </div>

      {!advanced && (
        <>
          <div className="flex gap-1.5">
            {(['once', 'hourly', 'daily', 'weekly'] as SchedulePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors ${
                  preset === p
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t(`resources.schedule.preset.${p}`)}
              </button>
            ))}
          </div>

          {preset === 'once' && (
            <div className="flex items-center gap-2">
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs font-normal">
                    <CalendarIcon className="size-3.5 text-muted-foreground" />
                    {selectedDate ? format(selectedDate, 'MMM d, yyyy') : t('resources.schedule.pickDate')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto border-border p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={updateDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  />
                </PopoverContent>
              </Popover>
              <TimePicker value={value.timeOfDay ?? '09:00'} onChange={updateTime} />
            </div>
          )}

          {preset === 'hourly' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('resources.schedule.atMinute')}</span>
              <input
                type="number"
                min={0}
                max={59}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                value={value.minuteOfHour ?? 0}
                onChange={(e) => updateMinute(parseInt(e.target.value) || 0)}
              />
              <span className="text-xs text-muted-foreground">{t('resources.schedule.pastHour')}</span>
            </div>
          )}

          {preset === 'daily' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('resources.schedule.time')}</span>
              <TimePicker value={value.timeOfDay ?? '09:00'} onChange={updateTime} />
            </div>
          )}

          {preset === 'weekly' && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1">
                {DAY_KEYS.map((dayKey, i) => {
                  const dayVal = DAY_VALUES[i]
                  const selected = value.dayOfWeek?.includes(dayVal) ?? false
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => toggleDay(dayVal)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {t(`resources.schedule.days.${dayKey}`)}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('resources.schedule.time')}</span>
                <TimePicker value={value.timeOfDay ?? '09:00'} onChange={updateTime} />
              </div>
            </div>
          )}
        </>
      )}

      {advanced && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">{t('resources.schedule.cronExpression')}</span>
            <input
              type="text"
              className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
              value={value.cron ?? ''}
              onChange={(e) => updateCron(e.target.value)}
              placeholder="0 9 * * 1-5"
            />
          </label>
        </div>
      )}

      {nextRuns.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {t('resources.schedule.nextRuns', { runs: nextRuns.map(formatNextRun).join(', ') })}
        </div>
      )}
    </div>
  )
}
