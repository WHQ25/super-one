import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'

type KeyStatus = { configured: boolean; masked: string }

/**
 * The Jev fast inner loop toggle plus its API key form, rendered as rows of
 * the General → Experimental card. The loop backs browser, desktop and device
 * runs alike, so it lives with the other app-wide experiments rather than
 * under Browser; each run tool checks its own runtime prerequisites (CDP,
 * computer use) when invoked.
 *
 * Self-contained like `SessionStorageSection`: reads its own settings and key
 * status, keeps `AppSettingsPage` a layout file.
 */
export function JevFastLoopSetting() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [key, setKey] = useState<KeyStatus>({ configured: false, masked: '' })
  const [keyEditing, setKeyEditing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setEnabled(settings.jevFastLoopEnabled)
      setLoading(false)
    })
    window.app.getJevApiKeyStatus().then((status) => {
      if (mounted) setKey(status)
    })
    return () => { mounted = false }
  }, [])

  // Turning the loop on without a key opens the key form instead; the setting
  // flips only once a key is stored, so "enabled" always means "usable".
  async function handleToggle(next: boolean) {
    if (next && !key.configured) {
      setKeyEditing(true)
      return
    }
    const result = await window.app.saveAppSettings({ jevFastLoopEnabled: next })
    setEnabled(result.jevFastLoopEnabled)
  }

  async function saveKey() {
    const draft = keyDraft.trim()
    if (!draft) return
    setKeyError(null)
    try {
      const status = await window.app.setJevApiKey(draft)
      setKey(status)
      setKeyDraft('')
      setKeyEditing(false)
      if (!enabled) {
        const result = await window.app.saveAppSettings({ jevFastLoopEnabled: true })
        setEnabled(result.jevFastLoopEnabled)
      }
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancelKeyEdit() {
    setKeyEditing(false)
    setKeyDraft('')
    setKeyError(null)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.general.experimentalJev.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.general.experimentalJev.description')}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => void handleToggle(v)} disabled={loading} />
      </div>
      {(enabled || keyEditing) && (
        <div className="border-t border-border p-4">
          <p className="text-sm font-medium">{t('settings.general.experimentalJev.apiKey.label')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.general.experimentalJev.apiKey.description')}</p>
          {keyEditing ? (
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void saveKey()
              }}
            >
              <Input
                type="password"
                autoFocus
                aria-label={t('settings.general.experimentalJev.apiKey.label')}
                placeholder={t('settings.general.experimentalJev.apiKey.placeholder')}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                className="max-w-sm font-mono text-xs"
              />
              <Button type="submit" size="sm" disabled={!keyDraft.trim()}>
                {t('settings.general.experimentalJev.apiKey.save')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancelKeyEdit}>
                {t('settings.general.experimentalJev.apiKey.cancel')}
              </Button>
            </form>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <p className="font-mono text-xs">{key.masked}</p>
              <Button variant="outline" size="sm" onClick={() => setKeyEditing(true)}>
                {t('settings.general.experimentalJev.apiKey.change')}
              </Button>
            </div>
          )}
          {keyError && <p className="mt-1 text-xs text-destructive">{keyError}</p>}
        </div>
      )}
    </>
  )
}
