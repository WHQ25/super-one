import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Switch } from '@superone/ui/components/ui/switch'
import { SettingsPage, SettingsRow, SettingsSection, SettingsSubheader, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'

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
    <SettingsRow
      label={label}
      description={destructive ? <span className="text-destructive">{description}</span> : description}
    >
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </SettingsRow>
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
      setDownloadDir(settings.browserDownloadDir)
      setLoading(false)
    })
    window.app.getDefaultDownloadDir().then((dir) => {
      if (mounted) setSystemDownloadDir(dir)
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
    <SettingsPage title={t('settings.browser.title')}>
      <SettingsSection>
        <SettingsRow
          label={t('settings.browser.downloadDir.label')}
          description={(
            <>
              {t('settings.browser.downloadDir.description')}
              <span className="mt-1.5 block truncate font-mono text-foreground" title={downloadDir ?? systemDownloadDir}>
                {downloadDir ?? systemDownloadDir}
              </span>
              {!downloadDir && (
                <span className="mt-0.5 block">{t('settings.browser.downloadDir.usingSystemDefault')}</span>
              )}
            </>
          )}
        >
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
          <Button variant="outline" size="sm" className="h-7" onClick={() => void pickDownloadDir()} disabled={loading}>
            {t('settings.browser.downloadDir.change')}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          label={t('settings.browser.cdp.label')}
          description={t('settings.browser.cdp.description')}
        >
          <Switch
            checked={cdpEnabled}
            onCheckedChange={handleCdpToggle}
            disabled={loading}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          label={t('settings.browser.webmcp.title')}
          description={(
            <>
              {t('settings.browser.webmcp.description')}
              <span className="mt-1 block">{t('settings.browser.webmcp.restartNote')}</span>
            </>
          )}
        >
          <Switch
            checked={webmcpEnabled}
            onCheckedChange={async (enabled) => {
              const result = await window.app.saveAppSettings({ webmcpEnabled: enabled })
              setWebmcpEnabled(result.webmcpEnabled)
            }}
            disabled={loading}
          />
        </SettingsRow>
        {webmcpEnabled && (
          <SettingsSubheader>{t('settings.browser.webmcp.grants.title')}</SettingsSubheader>
        )}
        {webmcpEnabled && webmcpTrustedOrigins.length === 0 && (
          <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
            {t('settings.browser.webmcp.grants.empty')}
          </p>
        )}
        {webmcpEnabled && webmcpTrustedOrigins.map((entry) => (
          <SettingsRow
            key={entry.origin}
            label={<span className="block truncate font-mono text-xs">{entry.origin}</span>}
            description={<span className="block truncate">{t('settings.browser.webmcp.grants.toolCount', {
              count: Object.keys(entry.tools).length,
            })}</span>}
          >
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('settings.browser.webmcp.grants.remove')}
              onClick={() => void revokeWebMcpOrigin(entry.origin)}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </SettingsRow>
        ))}
      </SettingsSection>

      <div>
        <SettingsSection
          title={t('settings.browser.experimental.title')}
          description={!cdpEnabled ? t('settings.browser.experimental.requiresCdp') : undefined}
        >
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
        </SettingsSection>
        <SettingsFootnote>{t('settings.browser.experimental.description')}</SettingsFootnote>
      </div>
    </SettingsPage>
  )
}
