import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Pencil, Play, Target, Trash2 } from 'lucide-react'
import type { AcpGoal } from '@superone/shared/agent-types'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@superone/ui/components/ui/popover'

interface GrokGoalIndicatorProps {
  goal: AcpGoal
  onEdit: () => void
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onClear: () => Promise<void>
}

export function GrokGoalIndicator({
  goal,
  onEdit,
  onPause,
  onResume,
  onClear,
}: GrokGoalIndicatorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>, closeOnSuccess = false) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (closeOnSuccess) setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const statusKey = `chat.acpGoal.statuses.${goal.status}`
  const canPause = goal.status === 'active'
  const canResume = goal.status === 'paused' || goal.status === 'blocked'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <Target data-icon="inline-start" />
          {t('chat.acpGoal.label')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-80 flex-col gap-3">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle>{t('chat.acpGoal.title')}</PopoverTitle>
            <Badge variant="secondary">{t(statusKey)}</Badge>
          </div>
          <PopoverDescription className="line-clamp-5 whitespace-pre-wrap">
            {goal.objective}
          </PopoverDescription>
        </PopoverHeader>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
            disabled={busy}
          >
            <Pencil data-icon="inline-start" />
            {t('chat.acpGoal.edit')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void run(onClear, true)}
            disabled={busy}
          >
            <Trash2 data-icon="inline-start" />
            {t('chat.acpGoal.clear')}
          </Button>
          <div className="flex-1" />
          {canPause && (
            <Button variant="outline" size="xs" onClick={() => void run(onPause)} disabled={busy}>
              <Pause data-icon="inline-start" />
              {t('chat.acpGoal.pause')}
            </Button>
          )}
          {canResume && (
            <Button size="xs" onClick={() => void run(onResume, true)} disabled={busy}>
              <Play data-icon="inline-start" />
              {t('chat.acpGoal.resume')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
