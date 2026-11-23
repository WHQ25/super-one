import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, RotateCcw, Trash2 } from 'lucide-react'
import type { WebmcpTrustedOrigin } from '@superone/shared/agent-types'
import {
  EXTENSION_BROWSERS,
  extensionBrowserById,
  isExtensionBrowserId,
  type ExtensionBrowserId,
} from '@superone/shared/chrome-extension-browsers'
import { cn } from '@superone/ui/lib/utils'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Switch } from '@superone/ui/components/ui/switch'
import { SettingsPage, SettingsRow, SettingsSection, SettingsSubheader, settingsRowClassName } from '@/components/settings/SettingsSection'
import { SettingsFootnote } from '@/components/settings/SettingsFootnote'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'
import { ExtensionBrowserIcon } from '@/components/settings/ExtensionBrowserIcon'

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

/**
 * A real directory drop. HTML5 drag from the renderer cannot land on
 * chrome://extensions; `startDrag` hands the folder to the OS.
 */
function ExtensionFolderDrag({ dir }: { dir: string }) {
  const { t } = useTranslation()
  const [dragEpoch, setDragEpoch] = useState(0)
  const name = dir.split(/[/\\]/).pop() || dir

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    window.app.startDrag([dir])
    const cleanup = (): void => {
      setDragEpoch((n) => n + 1)
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('dragend', cleanup)
  }

  return (
    <div
      key={dragEpoch}
      draggable
      onDragStart={handleDragStart}
      aria-label={t('settings.browser.ownBrowser.drag')}
      title={dir}
      className="inline-flex max-w-full cursor-grab items-center gap-2.5 active:cursor-grabbing"
    >
      <Folder className="size-9 shrink-0 text-amber-500" strokeWidth={1.5} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{name}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{dir}</span>
      </span>
    </div>
  )
}

function InstallStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="w-4 shrink-0 pt-px text-xs font-medium text-foreground">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  )
}

function ExtensionInstallSteps({ dir, excludeBrowsers = [] }: { dir: string; excludeBrowsers?: string[] }) {
  const { t } = useTranslation()
  const [browserId, setBrowserId] = useState<ExtensionBrowserId>('chrome')
  const [installedIds, setInstalledIds] = useState<string[]>([])
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userPicked = useRef(false)
  const excluded = new Set(excludeBrowsers)
  const availableBrowsers = EXTENSION_BROWSERS.filter((entry) => !excluded.has(entry.id))
  const installed = new Set(installedIds)
  const browsers = [...availableBrowsers].sort((a, b) => Number(installed.has(b.id)) - Number(installed.has(a.id)))
  const browser = availableBrowsers.find((entry) => entry.id === browserId) ?? browsers[0]

  useEffect(() => {
    let mounted = true
    void window.app.listChromeExtensionBrowsers?.().then((ids) => {
      if (!mounted || !ids?.length) return
      const known = ids.filter(isExtensionBrowserId)
      setInstalledIds(known)
      setBrowserId((current) => {
        if (userPicked.current && !excluded.has(current)) return current
        const firstAvailableInstalled = known.find((id) => !excluded.has(id))
        if (known.includes(current) && !excluded.has(current)) return current
        return firstAvailableInstalled ?? current
      })
    })
    return () => {
      mounted = false
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [excludeBrowsers.join(',')])

  if (!browser) return null

  async function openPage() {
    setOpening(true)
    setOpenFailed(false)
    try {
      const result = await window.app.openChromeExtensionPage(browser.id)
      if (!result?.opened) setOpenFailed(true)
    } catch {
      setOpenFailed(true)
    } finally {
      setOpening(false)
    }
  }

  async function copyAddress() {
    await window.app.clipboardWrite(browser.extensionsUrl)
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <ol className="space-y-3">
      <InstallStep n={1}>
        <p className="text-xs text-muted-foreground">{t('settings.browser.ownBrowser.steps.choose')}</p>
        <SettingsSegmentedControl
          className="mt-1.5"
          label={t('settings.browser.ownBrowser.steps.choose')}
          value={browser.id}
          onChange={(id) => {
            userPicked.current = true
            setBrowserId(id)
            setOpenFailed(false)
            setCopied(false)
          }}
          options={browsers.map((entry) => ({ value: entry.id, label: entry.label }))}
        />
      </InstallStep>
      <InstallStep n={2}>
        <p className="text-xs text-muted-foreground">{t('settings.browser.ownBrowser.steps.open')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-7" disabled={opening} onClick={() => void openPage()}>
            {t('settings.browser.ownBrowser.steps.openPage')}
          </Button>
          <Button variant="outline" size="sm" className="h-7" onClick={() => void copyAddress()}>
            {t(copied ? 'settings.browser.ownBrowser.steps.copied' : 'settings.browser.ownBrowser.steps.copyAddress')}
          </Button>
          <span className="truncate font-mono text-[11px] text-foreground" title={browser.extensionsUrl}>
            {browser.extensionsUrl}
          </span>
        </div>
        {openFailed && (
          <p className="mt-1 text-xs text-destructive">
            {t('settings.browser.ownBrowser.steps.openFailed', { browser: browser.appName })}
          </p>
        )}
      </InstallStep>
      <InstallStep n={3}>
        <p className="text-xs text-muted-foreground">{t('settings.browser.ownBrowser.steps.drag')}</p>
        {dir && (
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
            <ExtensionFolderDrag dir={dir} />
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => void window.app.revealChromeExtension?.()}
            >
              {t('settings.browser.ownBrowser.show')}
            </Button>
          </div>
        )}
      </InstallStep>
    </ol>
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
  const [disabledBrowsers, setDisabledBrowsers] = useState<string[]>([])
  const [chromeStatus, setChromeStatus] = useState<{ connected: boolean; browsers?: string[]; extensionDir: string } | null>(null)
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
      setDisabledBrowsers(settings.chromeBridgeDisabledBrowsers ?? [])
      setLoading(false)
    })
    window.app.getDefaultDownloadDir().then((dir) => {
      if (mounted) setSystemDownloadDir(dir)
    })
    void window.app.getChromeBridgeStatus?.().then((status) => {
      if (mounted && status) setChromeStatus(status)
    })
    const unsubscribeChrome = window.app.onChromeBridgeStatus?.((status) => {
      if (mounted) setChromeStatus(status)
    })
    return () => { mounted = false; unsubscribeChrome?.() }
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

  async function toggleBrowserControl(browserId: string, enabled: boolean) {
    const next = enabled
      ? disabledBrowsers.filter((id) => id !== browserId)
      : [...new Set([...disabledBrowsers, browserId])]
    const result = await window.app.saveAppSettings({ chromeBridgeDisabledBrowsers: next })
    setDisabledBrowsers(result.chromeBridgeDisabledBrowsers ?? [])
  }

  const expDisabled = loading || !cdpEnabled

  const connectedBrowsers = chromeStatus?.browsers ?? []
  const chromeConnected = chromeStatus?.connected === true || connectedBrowsers.length > 0
  const connectedSet = new Set(connectedBrowsers)
  const disabledSet = new Set(disabledBrowsers)
  const remainingBrowsers = EXTENSION_BROWSERS.filter((entry) => !connectedSet.has(entry.id))

  return (
    <SettingsPage title={t('settings.browser.title')}>
      {chromeConnected && (
        <SettingsSection title={t('settings.browser.ownBrowser.title')}>
          {connectedBrowsers.length > 0 ? (
            connectedBrowsers.map((id) => {
              const info = extensionBrowserById(id)
              const label = info?.label ?? t('settings.browser.ownBrowser.unknownBrowser')
              const enabled = !disabledSet.has(id)
              return (
                <SettingsRow
                  key={id}
                  label={(
                    <div className="flex items-center gap-3">
                      <ExtensionBrowserIcon id={id} className="size-9" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{label}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn('size-1.5 shrink-0 rounded-full', enabled ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-hidden="true" />
                          <span>{t(enabled ? 'settings.browser.ownBrowser.connectedStatus' : 'settings.browser.ownBrowser.disabledStatus')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                >
                  <Switch
                    aria-label={`${t('settings.browser.ownBrowser.controlToggle')} ${label}`}
                    checked={enabled}
                    disabled={loading}
                    onCheckedChange={(checked) => void toggleBrowserControl(id, checked)}
                  />
                </SettingsRow>
              )
            })
          ) : (
            <SettingsRow label={t('settings.browser.ownBrowser.connected.label')} />
          )}
        </SettingsSection>
      )}

      <SettingsSection title={t('settings.browser.ownBrowser.installTitle')}>
        {chromeStatus && remainingBrowsers.length > 0 ? (
          <div className={settingsRowClassName}>
            <ExtensionInstallSteps dir={chromeStatus.extensionDir} excludeBrowsers={connectedBrowsers} />
          </div>
        ) : (
          <SettingsRow label={t('settings.browser.ownBrowser.allConnected')}>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void window.app.revealChromeExtension?.()}
              disabled={!chromeStatus?.extensionDir}
            >
              {t('settings.browser.ownBrowser.show')}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

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
