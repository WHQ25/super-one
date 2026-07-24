import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Pencil, Play, Target, Trash2 } from 'lucide-react'
import type { CodexGoal, CodexGoalStatus } from '@superone/shared/agent-types'
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

interface CodexGoalIndicatorProps {
  sessionId: string
  threadId: string
  goal: CodexGoal
  onGoalChange: (goal: CodexGoal | null) => void
  onEdit: () => void
}

export function CodexGoalIndicator({ sessionId, threadId, goal, onGoalChange, onEdit }: CodexGoalIndicatorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateStatus = async (status: CodexGoalStatus) => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.app.codexSetGoal(sessionId, threadId, goal.objective, status)
      onGoalChange(next)
      if (status === 'active') setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const clearGoal = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.app.codexClearGoal(sessionId, threadId)
      onGoalChange(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <Target data-icon="inline-start" />
          {t('chat.codex.goal.label')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex w-80 flex-col gap-3">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-3">
            <PopoverTitle>{t('chat.codex.goal.title')}</PopoverTitle>
            <Badge variant="secondary">{t(`chat.codex.goal.statuses.${goal.status}`)}</Badge>
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
            {t('chat.codex.goal.edit')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void clearGoal()} disabled={busy}>
            <Trash2 data-icon="inline-start" />
            {t('chat.codex.goal.clear')}
          </Button>
          <div className="flex-1" />
          {goal.status === 'active' && (
            <Button variant="outline" size="xs" onClick={() => void updateStatus('paused')} disabled={busy}>
              <Pause data-icon="inline-start" />
              {t('chat.codex.goal.pause')}
            </Button>
          )}
          {goal.status === 'paused' && (
            <Button size="xs" onClick={() => void updateStatus('active')} disabled={busy}>
              <Play data-icon="inline-start" />
              {t('chat.codex.goal.resume')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
