import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Input } from '@superone/ui/components/ui/input'
import { useChatStore } from '@/stores/chat'

const CURSOR_API_KEY_DASHBOARD_URL = 'https://cursor.com/dashboard/api'

/**
 * In-chat dialog prompting for a Cursor User API Key when send fails without one.
 */
export function CursorApiKeyDialog() {
  const { t } = useTranslation()
  const open = useChatStore((s) => s.cursorApiKeyPromptOpen)
  const close = useChatStore((s) => s.closeCursorApiKeyPrompt)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setApiKey('')
    setError(null)
    setSaving(false)
  }, [open])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close()
    },
    [close],
  )

  const handleGetKey = useCallback(() => {
    void window.app.openExternalLink(CURSOR_API_KEY_DASHBOARD_URL)
  }, [])

  const handleSave = useCallback(async () => {
    const trimmed = apiKey.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.app.setCursorApiKey(trimmed)
      toast.success(t('settings.harnesses.cursor.apiKeySaved'))
      try {
        await window.app.probeHarness?.('cursor')
      } catch {
        /* probe may fail until Cursor accepts the key */
      }
      // Force model list refresh so the composer selector populates after first auth.
      await initializeHarness('cursor', { force: true })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [apiKey, saving, t, initializeHarness, close])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t('chat.cursor.apiKeyPrompt.title')}
          </DialogTitle>
          <DialogDescription>{t('chat.cursor.apiKeyPrompt.description')}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t('chat.cursor.apiKeyPrompt.placeholder')}
          className="font-mono text-xs"
          autoComplete="off"
          autoFocus
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSave()
            }
          }}
        />

        <DialogFooter className="gap-2 sm:gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={handleGetKey} disabled={saving}>
            <ExternalLink className="size-3.5" />
            {t('chat.cursor.apiKeyPrompt.getKey')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!apiKey.trim() || saving}
            >
              {t('chat.cursor.apiKeyPrompt.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
