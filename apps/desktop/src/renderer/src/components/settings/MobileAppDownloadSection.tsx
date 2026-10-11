import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import type { MobileAppDownload, MobileAppDownloads } from '@superone/shared/mobile-updates'
import { useAppStore } from '@/stores/app'
import { SettingsDisclosureRow } from './SettingsDisclosureRow'
import { SettingsSection } from './SettingsSection'

export type MobileAppDownloadsState =
  | { status: 'loading' }
  | { status: 'ready'; downloads: MobileAppDownloads }
  | { status: 'error' }

/**
 * Settings → Remote Control → Mobile App: install QR codes for the phone apps
 * that pair with this desktop. Expanded until a phone is paired, since
 * installing is the first step of pairing; collapsed after, until opened.
 */
export function MobileAppDownloadSection({ hasPairedPhones }: {
  /** `null` until the paired list loads: stay shut rather than open and snap closed. */
  hasPairedPhones: boolean | null
}) {
  // Known before the fetch, so the title does not flip once it lands.
  const alpha = useAppStore((s) => s.appVariant) !== 'stable'
  const [state, setState] = useState<MobileAppDownloadsState>({ status: 'loading' })
  const [expanded, setExpanded] = useState<boolean | null>(null)

  const load = useCallback(() => {
    setState({ status: 'loading' })
    window.app.getMobileAppDownloads().then(
      (downloads) => setState(
        // Every miss collapses to null upstream, so two empty platforms is how
        // an offline fetch reads; a real gap leaves the other one present.
        downloads.android || downloads.ios ? { status: 'ready', downloads } : { status: 'error' },
      ),
      () => setState({ status: 'error' }),
    )
  }, [])

  useEffect(load, [load])

  const isExpanded = expanded ?? hasPairedPhones === false
  return (
    <MobileAppDownloadPanel
      alpha={alpha}
      state={state}
      expanded={isExpanded}
      onToggle={() => setExpanded(!isExpanded)}
      onRetry={load}
    />
  )
}

export function MobileAppDownloadPanel({ alpha, state, expanded, onToggle, onRetry }: {
  /** The desktop's own line; its phone apps are the alpha ones. */
  alpha: boolean
  state: MobileAppDownloadsState
  expanded: boolean
  onToggle: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <SettingsSection>
      <SettingsDisclosureRow
        expanded={expanded}
        onToggle={onToggle}
        icon={<Smartphone className="size-4" />}
        title={alpha ? t('settings.remote.thisDevice.mobileApp.titleAlpha') : t('settings.remote.thisDevice.mobileApp.title')}
        description={t('settings.remote.thisDevice.mobileApp.description')}
      >
        {state.status === 'error' ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{t('settings.remote.thisDevice.mobileApp.unreachable')}</p>
            <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
              {t('settings.remote.thisDevice.mobileApp.retry')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            <DownloadCard
              label={t('settings.remote.thisDevice.mobileApp.ios')}
              download={state.status === 'ready' ? state.downloads.ios : undefined}
            />
            <DownloadCard
              label={t('settings.remote.thisDevice.mobileApp.android')}
              download={state.status === 'ready' ? state.downloads.android : undefined}
            />
          </div>
        )}
      </SettingsDisclosureRow>
    </SettingsSection>
  )
}

/** `undefined` while loading, `null` when the track has nothing published. */
function DownloadCard({ label, download }: { label: string; download: MobileAppDownload | null | undefined }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-2 rounded-md bg-background/60 p-3 text-center">
      <div className="text-xs font-medium">{label}</div>
      {download === undefined ? (
        <div className="size-[132px] animate-pulse rounded-md bg-muted" />
      ) : download === null ? (
        <div className="flex size-[132px] items-center justify-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
          {t('settings.remote.thisDevice.mobileApp.unavailable')}
        </div>
      ) : (
        <>
          {/* The QR code needs a light quiet zone to scan in dark mode too. */}
          <div className="rounded-md bg-white p-1.5">
            <QRCodeSVG value={download.url} size={120} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t('settings.remote.thisDevice.mobileApp.version', { version: download.version, build: download.buildCode })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(download.url)
              toast.success(t('resources.remote.linkCopied'))
            }}
          >
            {t('settings.remote.thisDevice.mobileApp.copyLink')}
          </Button>
        </>
      )}
    </div>
  )
}
