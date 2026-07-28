import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Trash2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Textarea } from '@superone/ui/components/ui/textarea'
import type { CodexGoal } from '@superone/shared/agent-types'

interface CodexGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string | null
  threadId: string | null
  prefill?: string
  onGoalChange?: (goal: CodexGoal | null) => void
}

export function CodexGoalDialog({ open, onOpenChange, sessionId, threadId, prefill, onGoalChange }: CodexGoalDialogProps) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState<CodexGoal | null>(null)
  const [objective, setObjective] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (!sessionId || !threadId) {
      setGoal(null)
      setObjective(prefill ?? '')
      return
    }
    let cancelled = false
    setLoading(true)
    void window.app.codexGetGoal(sessionId, threadId)
      .then((result) => {
        if (cancelled) return
        setGoal(result)
        setObjective(prefill ?? result?.objective ?? '')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, sessionId, threadId, prefill])

  const handleSave = useCallback(async () => {
    if (!sessionId || !threadId) return
    const trimmed = objective.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.app.codexSetGoal(sessionId, threadId, trimmed)
      setGoal(next)
      onGoalChange?.(next)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [sessionId, threadId, objective, onOpenChange, onGoalChange])

  const handleClear = useCallback(async () => {
    if (!sessionId || !threadId) return
    setBusy(true)
    setError(null)
    try {
      await window.app.codexClearGoal(sessionId, threadId)
      setGoal(null)
      setObjective('')
      onGoalChange?.(null)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [sessionId, threadId, onOpenChange, onGoalChange])

  const canSave = !!sessionId && !!threadId && objective.trim().length > 0 && !busy
  const canClear = !!goal && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-4" />
            {t('chat.codex.goal.title')}
          </DialogTitle>
          <DialogDescription>
            {sessionId && threadId
              ? t('chat.codex.goal.description')
              : t('chat.codex.goal.noThread')}
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
          placeholder={t('chat.codex.goal.placeholder')}
          rows={4}
          disabled={!sessionId || !threadId || loading || busy}
          autoFocus
        />

        {goal && (
          <p className="text-xs text-muted-foreground">
            {t('chat.codex.goal.status', { status: goal.status })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {canClear && (
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={busy}>
              <Trash2 className="size-3.5" />
              {t('chat.codex.goal.clear')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {t('chat.codex.goal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
