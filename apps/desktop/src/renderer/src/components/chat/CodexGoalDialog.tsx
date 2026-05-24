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
  projectPath: string
  threadId: string | null
  prefill?: string
}

export function CodexGoalDialog({ open, onOpenChange, projectPath, threadId, prefill }: CodexGoalDialogProps) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState<CodexGoal | null>(null)
  const [objective, setObjective] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (!threadId) {
      setGoal(null)
      setObjective(prefill ?? '')
      return
    }
    let cancelled = false
    setLoading(true)
    void window.app.codexGetGoal(projectPath, threadId)
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
  }, [open, projectPath, threadId, prefill])

  const handleSave = useCallback(async () => {
    if (!threadId) return
    const trimmed = objective.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.app.codexSetGoal(projectPath, threadId, trimmed)
      setGoal(next)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [projectPath, threadId, objective, onOpenChange])

  const handleClear = useCallback(async () => {
    if (!threadId) return
    setBusy(true)
    setError(null)
    try {
      await window.app.codexClearGoal(projectPath, threadId)
      setGoal(null)
      setObjective('')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [projectPath, threadId, onOpenChange])

  const canSave = !!threadId && objective.trim().length > 0 && !busy
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
            {threadId
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
          disabled={!threadId || loading || busy}
          autoFocus
        />

        {goal && (
          <p className="text-[11px] text-muted-foreground">
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
