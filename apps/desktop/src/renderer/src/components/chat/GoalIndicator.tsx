import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheckBig, Goal, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
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
import { cn } from '@superone/ui/lib/utils'
import { modes } from './PermissionModeList'

// Same colouring as the Codex plan chip: both are "the next send means
// something else" postures, so they read as one family.
const GOAL_CHIP = modes.find((mode) => mode.id === 'plan')!

/**
 * One shape for all three chip states. Deliberately not the ghost `Button`
 * variant: that recolours its text on hover, and a chip only ever changes its
 * background so the state it reports stays legible while the pointer is on it.
 */
const CHIP = 'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors'

interface GoalIndicatorProps {
  /** `null` while goal mode is on but nothing has been set yet. */
  goal: SessionGoal | null
  capability: GoalCapability
  /** Brand name of whoever owns the goal — `Codex`, `Grok`, `Claude`. */
  harnessName: string
  /** Goal mode: the composer's next send becomes the objective. */
  composing: boolean
  onExitCompose: () => void
  /** Drop an achieved goal from the composer. Local only — it is already gone
   *  on the harness side, so there is nothing to send. */
  onDismiss: () => void
  onEdit: () => void
  onClear: () => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
}

/**
 * The composer's goal chip, shared by every harness that has a goal.
 *
 * Two faces. In goal mode it mirrors the Codex plan-mode chip: a static label
 * with a close button, telling the user what the next send will do. Once a goal
 * exists it becomes the popover trigger, and the icon breathes while the goal
 * is being pursued so a live goal reads as live without printing its status.
 *
 * Controls follow the capability rather than the harness id, and the optional
 * detail lines follow the goal itself: a field the harness does not report is
 * absent, so it renders nothing instead of a zero.
 */
export function GoalIndicator({
  goal,
  capability,
  harnessName,
  composing,
  onExitCompose,
  onDismiss,
  onEdit,
  onClear,
  onPause,
  onResume,
}: GoalIndicatorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pause can settle on the host (session/cancel) before `session_goal` arrives.
  // Keep the chip on Paused so a second click cannot post `/goal pause` again.
  const [pendingPause, setPendingPause] = useState(false)

  useEffect(() => {
    if (goal?.status !== 'active') setPendingPause(false)
  }, [goal?.status])

  if (composing || !goal) {
    return (
      <button
        type="button"
        onClick={onExitCompose}
        title={t('chat.goal.exitCompose')}
        className={cn('group/goal-mode', CHIP, GOAL_CHIP.color, GOAL_CHIP.hoverBg)}
      >
        <Goal className="size-3.5 shrink-0 group-hover/goal-mode:hidden" />
        <X className="hidden size-3.5 shrink-0 group-hover/goal-mode:block" />
        <span>{t('chat.goal.label')}</span>
      </button>
    )
  }

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

  const status = pendingPause && goal.status === 'active' ? 'paused' : goal.status
  // Blocked counts as resumable: the harness stopped itself, and the user
  // telling it to go again is exactly how that state is meant to be left.
  const canPause = capability.canPause && status === 'active'
  const canResume = capability.canPause && (status === 'paused' || status === 'blocked')
  const achieved = status === 'complete'

  // An achieved goal is a notice, not live state: the harness already cleared
  // it, so the only thing left to do is take the chip off the composer.
  if (achieved) {
    return (
      <button
        type="button"
        onClick={onDismiss}
        title={t('chat.goal.dismiss')}
        className={cn('group/goal-done', CHIP, 'text-success hover:bg-success/10')}
      >
        <CircleCheckBig className="size-3.5 shrink-0 group-hover/goal-done:hidden" />
        <X className="hidden size-3.5 shrink-0 group-hover/goal-done:block" />
        <span>{t('chat.goal.achieved')}</span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CHIP, GOAL_CHIP.color, GOAL_CHIP.hoverBg)}>
          <Goal className={cn('size-3.5 shrink-0', status === 'active' && 'animate-pulse')} />
          <span>{t('chat.goal.label')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-80 flex-col gap-3">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle>{t('chat.goal.title', { harness: harnessName })}</PopoverTitle>
            <Badge variant="secondary">{t(`chat.goal.statuses.${status}`)}</Badge>
          </div>
          <PopoverDescription className="line-clamp-5 whitespace-pre-wrap">
            {goal.objective}
          </PopoverDescription>
        </PopoverHeader>

        {goal.lastReason && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="line-clamp-3">
              {t('chat.goal.lastReason', { reason: goal.lastReason })}
            </span>
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
            <Button
              variant="outline"
              size="xs"
              onClick={() => void run(async () => {
                await onPause()
                setPendingPause(true)
              })}
              disabled={busy}
            >
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
