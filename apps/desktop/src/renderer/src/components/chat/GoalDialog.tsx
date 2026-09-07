import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Textarea } from '@superone/ui/components/ui/textarea'
import type { SessionGoal } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'

interface GoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: SessionGoal | null
  capability: GoalCapability
  /** Brand name of whoever owns the goal — `Codex`, `Grok`, `Claude`. */
  harnessName: string
  prefill?: string
  /**
   * Set when the harness cannot accept a goal yet — Codex needs a live thread,
   * which only exists after the first turn. Blocks the editor and explains why
   * instead of failing on save.
   */
  unavailable?: boolean
  onSave: (objective: string) => Promise<void>
  onClear?: () => Promise<void>
}

/**
 * Set / replace / clear the session goal.
 *
 * The prompt wording follows `capability.semantics`: Codex and Grok take an
 * objective to pursue, Claude takes a condition to satisfy. Same control, two
 * genuinely different things to type.
 */
export function GoalDialog({
  open,
  onOpenChange,
  existing,
  capability,
  harnessName,
  prefill,
  unavailable = false,
  onSave,
  onClear,
}: GoalDialogProps) {
  const { t } = useTranslation()
  const [objective, setObjective] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setObjective(prefill || existing?.objective || '')
  }, [open, prefill, existing])

  const runAndClose = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [onOpenChange])

  const trimmed = objective.trim()
  const canSave = !unavailable && trimmed.length > 0 && !busy
  const canClear = !!existing && !!onClear && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-4" />
            {t('chat.goal.title', { harness: harnessName })}
          </DialogTitle>
          <DialogDescription>
            {unavailable
              ? t('chat.goal.noSession')
              : t(`chat.goal.${capability.semantics}.description`, { harness: harnessName })}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder={t(`chat.goal.${capability.semantics}.placeholder`)}
          rows={4}
          disabled={unavailable || busy}
          autoFocus
        />

        {existing && (
          <p className="text-xs text-muted-foreground">
            {t('chat.goal.status', { status: t(`chat.goal.statuses.${existing.status}`) })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {canClear && (
            <Button variant="ghost" size="sm" onClick={() => void runAndClose(onClear!)} disabled={busy}>
              <Trash2 className="size-3.5" />
              {t('chat.goal.clear')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void runAndClose(() => onSave(trimmed))} disabled={!canSave}>
            {t('chat.goal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
