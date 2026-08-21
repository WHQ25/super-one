import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Textarea } from '@superone/ui/components/ui/textarea'
import type { AcpGoal } from '@superone/shared/agent-types'

interface GrokGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: AcpGoal | null
  prefill?: string
  onSave: (objective: string) => Promise<void>
  onClear?: () => Promise<void>
}

export function GrokGoalDialog({
  open,
  onOpenChange,
  existing,
  prefill,
  onSave,
  onClear,
}: GrokGoalDialogProps) {
  const { t } = useTranslation()
  const [objective, setObjective] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setObjective(prefill || existing?.objective || '')
  }, [open, prefill, existing])

  const handleSave = useCallback(async () => {
    const trimmed = objective.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await onSave(trimmed)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [objective, onSave, onOpenChange])

  const handleClear = useCallback(async () => {
    if (!onClear || !existing) return
    setBusy(true)
    setError(null)
    try {
      await onClear()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [existing, onClear, onOpenChange])

  const canSave = objective.trim().length > 0 && !busy
  const canClear = !!existing && !!onClear && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-4" />
            {t('chat.acpGoal.title')}
          </DialogTitle>
          <DialogDescription>{t('chat.acpGoal.description')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder={t('chat.acpGoal.placeholder')}
          rows={4}
          disabled={busy}
          autoFocus
        />

        {existing && (
          <p className="text-xs text-muted-foreground">
            {t('chat.acpGoal.status', { status: t(`chat.acpGoal.statuses.${existing.status}`) })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {canClear && (
            <Button variant="ghost" size="sm" onClick={() => void handleClear()} disabled={busy}>
              <Trash2 className="size-3.5" />
              {t('chat.acpGoal.clear')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
            {t('chat.acpGoal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
