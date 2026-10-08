import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Textarea } from '@superone/ui/components/ui/textarea'
import { settingsRowClassName } from '../SettingsSection'

/** Owner note agents read when choosing this computer (`agent.note` in its node config). */
export function NodeNoteEditor() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.app.getNodeHostNote().then((note) => {
      if (cancelled) return
      setSaved(note)
      setDraft(note)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const stored = await window.app.setNodeHostNote(draft)
      setSaved(stored)
      setDraft(stored)
      toast.success(t('settings.remote.nodeAccess.note.saved'))
    } catch (err) {
      toast.error(t('settings.remote.nodeAccess.note.saveFailed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSaving(false)
    }
  }

  const dirty = saved !== null && draft.trim() !== saved

  return (
    <div className={settingsRowClassName}>
      <label htmlFor="node-note" className="text-sm">{t('settings.remote.nodeAccess.note.label')}</label>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.remote.nodeAccess.note.description')}</p>
      <Textarea
        id="node-note"
        className="mt-2 min-h-16 text-sm"
        placeholder={t('settings.remote.nodeAccess.note.placeholder')}
        value={draft}
        disabled={saved === null || saving}
        onChange={(e) => setDraft(e.target.value)}
      />
      {dirty && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" className="h-7" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('settings.remote.nodeAccess.note.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
