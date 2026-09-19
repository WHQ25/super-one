import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'

function ExperimentalRow({
  label,
  description,
  destructive,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  description: string
  destructive?: boolean
  checked: boolean
  disabled: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className={cn('mt-0.5 text-xs', destructive ? 'text-destructive' : 'text-muted-foreground')}>{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

export function BrowserSettingsPage() {
  const { t } = useTranslation()
  const [cdpEnabled, setCdpEnabled] = useState(false)
  const [webmcpEnabled, setWebmcpEnabled] = useState(false)
  const [webmcpTrustedOrigins, setWebmcpTrustedOrigins] = useState<WebmcpTrustedOrigin[]>([])
  const [cookiesEnabled, setCookiesEnabled] = useState(false)
  const [mockEnabled, setMockEnabled] = useState(false)
  const [emulateEnabled, setEmulateEnabled] = useState(false)
  const [jevEnabled, setJevEnabled] = useState(false)
  const [jevKey, setJevKey] = useState<{ configured: boolean; masked: string }>({ configured: false, masked: '' })
  const [jevKeyEditing, setJevKeyEditing] = useState(false)
  const [jevKeyDraft, setJevKeyDraft] = useState('')
  const [jevKeyError, setJevKeyError] = useState<string | null>(null)
  const [downloadDir, setDownloadDir] = useState<string | null>(null)
  const [systemDownloadDir, setSystemDownloadDir] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setCdpEnabled(settings.cdpEnabled)
      setWebmcpEnabled(settings.webmcpEnabled)
      setWebmcpTrustedOrigins(settings.webmcpTrustedOrigins)
      setCookiesEnabled(settings.cdpCookiesEnabled)
      setMockEnabled(settings.cdpMockEnabled)
      setEmulateEnabled(settings.cdpEmulateEnabled)
      setJevEnabled(settings.jevFastLoopEnabled)
      setDownloadDir(settings.browserDownloadDir)
      setLoading(false)
    })
    window.app.getDefaultDownloadDir().then((dir) => {
      if (mounted) setSystemDownloadDir(dir)
    })
    window.app.getJevApiKeyStatus().then((status) => {
      if (mounted) setJevKey(status)
    })
    return () => { mounted = false }
  }, [])

  async function handleCdpToggle(enabled: boolean) {
    const result = await window.app.saveAppSettings({ cdpEnabled: enabled })
    setCdpEnabled(result.cdpEnabled)
    setCookiesEnabled(result.cdpCookiesEnabled)
    setMockEnabled(result.cdpMockEnabled)
    setEmulateEnabled(result.cdpEmulateEnabled)
  }

  // Turning the loop on without a key opens the key form instead; the setting
  // flips only once a key is stored, so "enabled" always means "usable".
  async function handleJevToggle(enabled: boolean) {
    if (enabled && !jevKey.configured) {
      setJevKeyEditing(true)
      return
    }
    const result = await window.app.saveAppSettings({ jevFastLoopEnabled: enabled })
    setJevEnabled(result.jevFastLoopEnabled)
  }

  async function saveJevKey() {
    const key = jevKeyDraft.trim()
    if (!key) return
    setJevKeyError(null)
    try {
      const status = await window.app.setJevApiKey(key)
      setJevKey(status)
      setJevKeyDraft('')
      setJevKeyEditing(false)
      if (!jevEnabled) {
        const result = await window.app.saveAppSettings({ jevFastLoopEnabled: true })
        setJevEnabled(result.jevFastLoopEnabled)
      }
    } catch (err) {
      setJevKeyError(err instanceof Error ? err.message : String(err))
    }
  }

  async function pickDownloadDir() {
    const dir = await window.app.selectFolder(downloadDir ?? systemDownloadDir)
    if (!dir) return
    const result = await window.app.saveAppSettings({ browserDownloadDir: dir })
    setDownloadDir(result.browserDownloadDir)
  }

  async function resetDownloadDir() {
    const result = await window.app.saveAppSettings({ browserDownloadDir: null })
    setDownloadDir(result.browserDownloadDir)
  }

  async function revokeWebMcpOrigin(origin: string) {
    const result = await window.app.saveAppSettings({
      webmcpTrustedOrigins: webmcpTrustedOrigins.filter((entry) => entry.origin !== origin),
    })
    setWebmcpTrustedOrigins(result.webmcpTrustedOrigins)
  }

  const expDisabled = loading || !cdpEnabled

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.browser.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.browser.subtitle')}</p>
      </div>

      <div className="mb-6 rounded-lg border border-border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.browser.downloadDir.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.browser.downloadDir.description')}
            </p>
            <p className="mt-1.5 truncate font-mono text-xs" title={downloadDir ?? systemDownloadDir}>
              {downloadDir ?? systemDownloadDir}
            </p>
            {!downloadDir && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('settings.browser.downloadDir.usingSystemDefault')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {downloadDir && (
              <IconButton
                size="sm"
                variant="ghost"
                tooltip={t('settings.browser.downloadDir.reset')}
                onClick={() => void resetDownloadDir()}
                disabled={loading}
              >
                <RotateCcw className="size-3.5" />
              </IconButton>
            )}
            <Button variant="outline" size="sm" onClick={() => void pickDownloadDir()} disabled={loading}>
              {t('settings.browser.downloadDir.change')}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.browser.cdp.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.browser.cdp.description')}
            </p>
          </div>
          <Switch
            checked={cdpEnabled}
            onCheckedChange={handleCdpToggle}
            disabled={loading}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.browser.webmcp.title')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings.browser.webmcp.description')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.browser.webmcp.restartNote')}
            </p>
          </div>
          <Switch
            checked={webmcpEnabled}
            onCheckedChange={async (enabled) => {
              const result = await window.app.saveAppSettings({ webmcpEnabled: enabled })
              setWebmcpEnabled(result.webmcpEnabled)
            }}
            disabled={loading}
          />
        </div>
        {webmcpEnabled && (
          <div className="border-t border-border p-4">
            <p className="text-sm font-medium">{t('settings.browser.webmcp.grants.title')}</p>
            {webmcpTrustedOrigins.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.browser.webmcp.grants.empty')}
              </p>
            ) : (
              <div className="mt-2 divide-y divide-border">
                {webmcpTrustedOrigins.map((entry) => (
                  <div key={entry.origin} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium">{entry.origin}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t('settings.browser.webmcp.grants.toolCount', {
                          count: Object.keys(entry.tools).length,
                        })}
                      </p>
                    </div>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      tooltip={t('settings.browser.webmcp.grants.remove')}
                      onClick={() => void revokeWebMcpOrigin(entry.origin)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border">
        <div className="p-4">
          <p className="text-sm font-medium">{t('settings.browser.experimental.title')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.browser.experimental.description')}</p>
          {!cdpEnabled && (
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.browser.experimental.requiresCdp')}</p>
          )}
        </div>
        <ExperimentalRow
          label={t('settings.browser.experimental.cookies.label')}
          description={t('settings.browser.experimental.cookies.description')}
          checked={cdpEnabled && cookiesEnabled}
          disabled={expDisabled}
          onCheckedChange={async (v) => {
            const r = await window.app.saveAppSettings({ cdpCookiesEnabled: v })
            setCookiesEnabled(r.cdpCookiesEnabled)
          }}
        />
        <ExperimentalRow
          label={t('settings.browser.experimental.emulate.label')}
          description={t('settings.browser.experimental.emulate.description')}
          checked={cdpEnabled && emulateEnabled}
          disabled={expDisabled}
          onCheckedChange={async (v) => {
            const r = await window.app.saveAppSettings({ cdpEmulateEnabled: v })
            setEmulateEnabled(r.cdpEmulateEnabled)
          }}
        />
        <ExperimentalRow
          label={t('settings.browser.experimental.mock.label')}
          description={t('settings.browser.experimental.mock.description')}
          destructive
          checked={cdpEnabled && mockEnabled}
          disabled={expDisabled}
          onCheckedChange={async (v) => {
            const r = await window.app.saveAppSettings({ cdpMockEnabled: v })
            setMockEnabled(r.cdpMockEnabled)
          }}
        />
        <ExperimentalRow
          label={t('settings.browser.experimental.jev.label')}
          description={t('settings.browser.experimental.jev.description')}
          checked={cdpEnabled && jevEnabled}
          disabled={expDisabled}
          onCheckedChange={handleJevToggle}
        />
        {cdpEnabled && (jevEnabled || jevKeyEditing) && (
          <div className="border-t border-border p-4">
            <p className="text-sm font-medium">{t('settings.browser.experimental.jev.apiKey.label')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.browser.experimental.jev.apiKey.description')}</p>
            {jevKeyEditing ? (
              <form
                className="mt-2 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveJevKey()
                }}
              >
                <Input
                  type="password"
                  autoFocus
                  aria-label={t('settings.browser.experimental.jev.apiKey.label')}
                  placeholder={t('settings.browser.experimental.jev.apiKey.placeholder')}
                  value={jevKeyDraft}
                  onChange={(e) => setJevKeyDraft(e.target.value)}
                  className="max-w-sm font-mono text-xs"
                />
                <Button type="submit" size="sm" disabled={!jevKeyDraft.trim()}>
                  {t('settings.browser.experimental.jev.apiKey.save')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setJevKeyEditing(false)
                    setJevKeyDraft('')
                    setJevKeyError(null)
                  }}
                >
                  {t('settings.browser.experimental.jev.apiKey.cancel')}
                </Button>
              </form>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <p className="font-mono text-xs">{jevKey.masked}</p>
                <Button variant="outline" size="sm" onClick={() => setJevKeyEditing(true)}>
                  {t('settings.browser.experimental.jev.apiKey.change')}
                </Button>
              </div>
            )}
            {jevKeyError && <p className="mt-1 text-xs text-destructive">{jevKeyError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
