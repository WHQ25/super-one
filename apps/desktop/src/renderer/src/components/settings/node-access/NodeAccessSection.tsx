import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import type { NodeHostPairingToken, NodeHostStatus } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { SettingsRow, SettingsSection, settingsRowClassName } from '../SettingsSection'
import { NodeNoteEditor } from './NodeNoteEditor'
import { NodePairingCodePanel } from './NodePairingCodePanel'

interface AccessSettings {
  enabled: boolean
  port: number | null
}

/** Mirrors main `readNodePort`: anything outside this range means the default. */
function parsePort(draft: string): number | null | 'invalid' {
  const trimmed = draft.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : 'invalid'
}

/**
 * "Run tasks for other devices": serve this computer as a node that paired
 * desktops start sessions on, mint pairing codes, and keep the owner note.
 */
export function NodeAccessSection() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AccessSettings | null>(null)
  const [status, setStatus] = useState<NodeHostStatus | null>(null)
  /** A settings change is restarting the node surface. */
  const [applying, setApplying] = useState(false)
  const [portDraft, setPortDraft] = useState('')
  const [portError, setPortError] = useState(false)
  const [pairing, setPairing] = useState<NodeHostPairingToken | null>(null)
  const [minting, setMinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.app.getAppSettings(), window.app.getNodeHostStatus()]).then(([app, host]) => {
      if (cancelled) return
      setSettings({ enabled: app.remoteNodeAccessEnabled, port: app.remoteNodeAccessPort })
      setPortDraft(app.remoteNodeAccessPort?.toString() ?? '')
      setStatus(host)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const apply = useCallback(async (patch: { remoteNodeAccessEnabled?: boolean; remoteNodeAccessPort?: number | null }) => {
    setApplying(true)
    // Show the starting state while main brings the surface up.
    const optimistic = patch.remoteNodeAccessEnabled
    if (optimistic !== undefined) setSettings((prev) => prev && { ...prev, enabled: optimistic })
    try {
      // Resolves after main has started or stopped the node surface.
      const next = await window.app.saveAppSettings(patch)
      setSettings({ enabled: next.remoteNodeAccessEnabled, port: next.remoteNodeAccessPort })
      setPortDraft(next.remoteNodeAccessPort?.toString() ?? '')
      setStatus(await window.app.getNodeHostStatus())
      // A token belongs to the server that minted it.
      setPairing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      await window.app.getAppSettings()
        .then((current) => setSettings({ enabled: current.remoteNodeAccessEnabled, port: current.remoteNodeAccessPort }))
        .catch(() => {})
    } finally {
      setApplying(false)
    }
  }, [])

  function commitPort(): void {
    const parsed = parsePort(portDraft)
    if (parsed === 'invalid') {
      setPortError(true)
      return
    }
    setPortError(false)
    if (parsed !== (settings?.port ?? null)) void apply({ remoteNodeAccessPort: parsed })
  }

  async function mintCode(): Promise<void> {
    setMinting(true)
    try {
      setPairing(await window.app.mintNodeHostPairingToken())
    } catch (err) {
      toast.error(t('settings.remote.nodeAccess.mintFailed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setMinting(false)
    }
  }

  const enabled = settings?.enabled ?? false
  const running = status?.running === true

  return (
    <SettingsSection
      title={t('settings.remote.nodeAccess.title')}
      actions={enabled && !pairing ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={!running || applying || minting}
          onClick={() => void mintCode()}
        >
          {minting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t('settings.remote.nodeAccess.addDevice')}
        </Button>
      ) : null}
    >
      <SettingsRow
        label={t('settings.remote.nodeAccess.enableLabel')}
        description={t('settings.remote.nodeAccess.enableDescription')}
      >
        <Switch
          checked={enabled}
          disabled={!settings || applying}
          onCheckedChange={(checked) => void apply({ remoteNodeAccessEnabled: checked })}
          aria-label={t('settings.remote.nodeAccess.enableLabel')}
        />
      </SettingsRow>

      {enabled && (
        <>
          <NodeHostStatusRow applying={applying} status={status} />

          <SettingsRow
            label={t('settings.remote.nodeAccess.port')}
            description={portError
              ? <span className="text-destructive">{t('settings.remote.nodeAccess.portInvalid')}</span>
              : t('settings.remote.nodeAccess.portDescription')}
          >
            <Input
              aria-label={t('settings.remote.nodeAccess.port')}
              aria-invalid={portError}
              inputMode="numeric"
              className="h-7 w-24 text-right font-mono text-xs"
              placeholder={t('settings.remote.nodeAccess.portPlaceholder')}
              value={portDraft}
              disabled={applying}
              onChange={(e) => {
                setPortDraft(e.target.value)
                setPortError(false)
              }}
              onBlur={commitPort}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitPort()
              }}
            />
          </SettingsRow>

          {pairing && (
            <div className={settingsRowClassName}>
              <NodePairingCodePanel
                token={pairing}
                renewing={minting}
                onRenew={() => void mintCode()}
                onDone={() => setPairing(null)}
              />
            </div>
          )}

          <NodeNoteEditor />
        </>
      )}
    </SettingsSection>
  )
}

function NodeHostStatusRow({ applying, status }: { applying: boolean; status: NodeHostStatus | null }) {
  const { t } = useTranslation()
  const state = applying || !status ? 'starting' : status.running ? 'listening' : status.error ? 'error' : 'off'
  return (
    <div className={cn(settingsRowClassName, 'flex min-w-0 items-center gap-2 text-xs')} role="status">
      {state === 'starting' ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            state === 'listening' ? 'bg-success' : state === 'error' ? 'bg-destructive' : 'bg-muted-foreground/40',
          )}
        />
      )}
      <span
        className={cn(
          'min-w-0 break-words',
          state === 'error' ? 'text-destructive' : 'text-muted-foreground',
          state === 'listening' && 'truncate font-mono',
        )}
      >
        {state === 'listening'
          ? t('settings.remote.nodeAccess.status.listening', { url: status?.url ?? '' })
          : state === 'error'
            ? t('settings.remote.nodeAccess.status.error', { error: status?.error ?? '' })
            : t(`settings.remote.nodeAccess.status.${state}`)}
      </span>
    </div>
  )
}
