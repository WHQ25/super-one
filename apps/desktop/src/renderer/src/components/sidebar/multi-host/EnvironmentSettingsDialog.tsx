import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'

/**
 * Settings for one environment. The name is the first section; later settings
 * (permissions and the rest) belong in this dialog.
 */
export function EnvironmentSettingsDialog({
  open,
  name,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  name: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  /**
   * Chromium often reports `isComposing=false` on the Enter that confirms an
   * IME candidate. Keep our own flag and clear it one frame late.
   */
  const imeComposingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setDraft(name)
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, name])

  async function commit(): Promise<void> {
    if (savingRef.current) return
    const next = draft.trim()
    if (!next || next.length > 80) return
    if (next === name) {
      onOpenChange(false)
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await onSubmit(next)
      onOpenChange(false)
    } catch {
      // Stay on the field. The caller reports the failure.
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const canSave = draft.trim().length > 0 && !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('sidebar.environmentSettings.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="environment-settings-name">{t('sidebar.environmentSettings.name')}</Label>
          <Input
            ref={inputRef}
            id="environment-settings-name"
            value={draft}
            maxLength={80}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => { imeComposingRef.current = true }}
            onCompositionEnd={() => {
              requestAnimationFrame(() => { imeComposingRef.current = false })
            }}
            onKeyDown={(event) => {
              if (
                imeComposingRef.current
                || event.nativeEvent.isComposing
                || event.keyCode === 229
              ) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => void commit()} disabled={!canSave}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
