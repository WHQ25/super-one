import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
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
  const [cookiesEnabled, setCookiesEnabled] = useState(false)
  const [mockEnabled, setMockEnabled] = useState(false)
  const [emulateEnabled, setEmulateEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setCdpEnabled(settings.cdpEnabled)
      setCookiesEnabled(settings.cdpCookiesEnabled)
      setMockEnabled(settings.cdpMockEnabled)
      setEmulateEnabled(settings.cdpEmulateEnabled)
      setLoading(false)
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

  const expDisabled = loading || !cdpEnabled

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">{t('settings.browser.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.browser.subtitle')}</p>
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
      </div>
    </div>
  )
}
