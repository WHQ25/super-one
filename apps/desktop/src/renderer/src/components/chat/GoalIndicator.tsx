import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Pencil, Play, Target, Trash2 } from 'lucide-react'
import type { SessionGoal } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'
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

interface GoalIndicatorProps {
  goal: SessionGoal
  capability: GoalCapability
  /** Brand name of whoever owns the goal — `Codex`, `Grok`, `Claude`. */
  harnessName: string
  onEdit: () => void
  onClear: () => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
}

/**
 * The composer's goal chip, shared by every harness that has a goal.
 *
 * Controls follow the capability rather than the harness id, and the optional
 * detail lines follow the goal itself: a field the harness does not report is
 * absent, so it renders nothing instead of a zero.
 */
export function GoalIndicator({
  goal,
  capability,
  harnessName,
  onEdit,
  onClear,
  onPause,
  onResume,
}: GoalIndicatorProps) {
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

  // Blocked counts as resumable: the harness stopped itself, and the user
  // telling it to go again is exactly how that state is meant to be left.
  const canPause = capability.canPause && goal.status === 'active'
  const canResume = capability.canPause && (goal.status === 'paused' || goal.status === 'blocked')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <Target data-icon="inline-start" />
          {t('chat.goal.label')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-80 flex-col gap-3">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle>{t('chat.goal.title', { harness: harnessName })}</PopoverTitle>
            <Badge variant="secondary">{t(`chat.goal.statuses.${goal.status}`)}</Badge>
          </div>
          <PopoverDescription className="line-clamp-5 whitespace-pre-wrap">
            {goal.objective}
          </PopoverDescription>
        </PopoverHeader>

        {(goal.iterations != null || goal.lastReason) && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {goal.iterations != null && (
              <span>{t('chat.goal.iterations', { count: goal.iterations })}</span>
            )}
            {goal.lastReason && (
              <span className="line-clamp-3">
                {t('chat.goal.lastReason', { reason: goal.lastReason })}
              </span>
            )}
          </div>
        )}

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
            {t('chat.goal.edit')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void run(onClear, true)} disabled={busy}>
            <Trash2 data-icon="inline-start" />
            {t('chat.goal.clear')}
          </Button>
          <div className="flex-1" />
          {canPause && (
            <Button variant="outline" size="xs" onClick={() => void run(onPause)} disabled={busy}>
              <Pause data-icon="inline-start" />
              {t('chat.goal.pause')}
            </Button>
          )}
          {canResume && (
            <Button size="xs" onClick={() => void run(onResume, true)} disabled={busy}>
              <Play data-icon="inline-start" />
              {t('chat.goal.resume')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
