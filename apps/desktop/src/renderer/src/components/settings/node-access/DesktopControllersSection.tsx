import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ControllerPairingEvent, NodeHostController, NodeHostStatus } from '@superone/shared/agent-types'
import { Plus } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { PairingCodeConfirm } from '../../PairingCodeConfirm'
import { PairingDialog } from '../../PairingDialog'
import { PairingQrPanel } from '../../PairingQrPanel'
import { DeviceRow, computerKind } from '../DeviceRow'
import { SettingsSection, settingsRowClassName } from '../SettingsSection'

export type ControllerPairing =
  | { step: 'idle' }
  | { step: 'scan'; qr: string }
  | { step: 'code'; qr: string; controllerName: string; phoneName: string }

/**
 * Control This Computer → Desktop: the desktops that run tasks here, and
 * "Pair New Desktop", a dialog with a controller QR for a phone paired with
 * the controlling desktop, then the code that phone shows. The node surface runs while one is paired; there is no
 * switch for it.
 */
export function DesktopControllersSection({ controlAllowed }: { controlAllowed: boolean }) {
  const { t } = useTranslation()
  const [controllers, setControllers] = useState<NodeHostController[]>([])
  const [status, setStatus] = useState<NodeHostStatus | null>(null)
  const [pairing, setPairing] = useState<ControllerPairing>({ step: 'idle' })
  const [starting, setStarting] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const [list, host] = await Promise.all([window.app.listNodeHostControllers(), window.app.getNodeHostStatus()])
    setControllers(list)
    setStatus(host)
  }, [])

  useEffect(() => {
    void refresh()
    return window.app.onNodeHostChanged(() => void refresh())
  }, [refresh])

  useEffect(() => window.app.onControllerPairingEvent((event: ControllerPairingEvent) => {
    if (event.type === 'request') {
      setCode('')
      setCodeError('')
      setPairing((prev) => prev.step === 'idle' ? prev : { step: 'code', qr: prev.qr, ...event })
    } else if (event.type === 'granted') {
      setPairing({ step: 'idle' })
      toast.success(t('settings.remote.thisDevice.desktop.pairing.granted', { name: event.controllerName }))
    } else {
      setPairing({ step: 'idle' })
      setNotice(event.reason === 'expired'
        ? t('settings.remote.thisDevice.desktop.pairing.expired')
        : event.reason === 'rejected'
          ? t('settings.remote.thisDevice.desktop.pairing.cancelled')
          : t('settings.remote.thisDevice.desktop.pairing.failed', { message: event.message ?? '' }))
    }
  }), [t])

  async function start(): Promise<void> {
    setStarting(true)
    setNotice('')
    try {
      setPairing({ step: 'scan', qr: await window.app.startControllerPairing() })
    } catch (err) {
      setNotice(t('settings.remote.thisDevice.desktop.pairing.failed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setStarting(false)
    }
  }

  async function confirm(): Promise<void> {
    setConfirming(true)
    setCodeError('')
    try {
      await window.app.confirmControllerPairing(code)
    } catch {
      setCodeError(t('resources.remote.codeError'))
    } finally {
      setConfirming(false)
    }
  }

  function cancel(): void {
    void window.app.cancelControllerPairing()
    setPairing({ step: 'idle' })
  }

  async function setEnabled(controller: NodeHostController, enabled: boolean): Promise<void> {
    setControllers((prev) => prev.map((c) => c.id === controller.id ? { ...c, enabled } : c))
    await window.app.setNodeHostControllerEnabled(controller.id, enabled)
    await refresh()
  }

  async function remove(controller: NodeHostController): Promise<void> {
    await window.app.removeNodeHostController(controller.id)
    toast.success(t('settings.remote.thisDevice.desktop.removed', { name: controller.label || t('settings.remote.thisDevice.desktop.title') }))
    await refresh()
  }

  return (
    <SettingsSection
      title={t('settings.remote.thisDevice.desktop.title')}
      actions={(
        <IconButton
          size="md"
          tooltip={t('resources.remote.pairNewDesktop')}
          disabled={!controlAllowed || starting || pairing.step !== 'idle'}
          onClick={() => void start()}
        >
          <Plus />
        </IconButton>
      )}
    >
      <DesktopControllersBody
        controllers={controllers}
        hostError={status?.error ?? null}
        notice={pairing.step === 'idle' ? notice : ''}
        controlAllowed={controlAllowed}
        onSetEnabled={(controller, enabled) => void setEnabled(controller, enabled)}
        onRemove={(controller) => void remove(controller)}
      />
      <PairingDialog
        open={pairing.step !== 'idle'}
        onOpenChange={(open) => !open && cancel()}
        title={t('resources.remote.pairNewDesktop')}
        description={t('settings.remote.thisDevice.desktop.pairing.scan')}
      >
        <ControllerPairingBody
          pairing={pairing}
          code={code}
          codeError={codeError}
          confirming={confirming}
          onCodeChange={setCode}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      </PairingDialog>
    </SettingsSection>
  )
}

/** The pairing dialog's body for each step, without IPC, for stories. */
export function ControllerPairingBody(props: {
  pairing: ControllerPairing
  code: string
  codeError: string
  confirming: boolean
  onCodeChange: (code: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { pairing } = props
  if (pairing.step === 'scan') {
    return (
      <PairingQrPanel
        hint={t('settings.remote.thisDevice.desktop.pairing.scan')}
        value={pairing.qr}
        onCancel={props.onCancel}
        // What pairing grants, said where the person decides to grant it.
        status={<p className="max-w-md text-xs text-muted-foreground">{t('settings.remote.thisDevice.desktop.pairing.grants')}</p>}
      />
    )
  }
  if (pairing.step === 'code') {
    return (
      <PairingCodeConfirm
        prompt={t('settings.remote.thisDevice.desktop.pairing.prompt', {
          phone: pairing.phoneName || t('settings.remote.thisDevice.mobile.title'),
          name: pairing.controllerName,
        })}
        code={props.code}
        onCodeChange={props.onCodeChange}
        error={props.codeError}
        confirming={props.confirming}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
      />
    )
  }
  return null
}

/** The section body, without IPC, for stories. */
export function DesktopControllersBody(props: {
  controllers: NodeHostController[]
  hostError: string | null
  notice: string
  /** Allow Control: off keeps every controller out whatever its own switch says. */
  controlAllowed: boolean
  onSetEnabled: (controller: NodeHostController, enabled: boolean) => void
  onRemove: (controller: NodeHostController) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {props.notice && (
        <p className={cn(settingsRowClassName, 'text-xs text-destructive')}>{props.notice}</p>
      )}

      {props.hostError && props.controllers.length > 0 && (
        <p className={cn(settingsRowClassName, 'break-words text-xs text-destructive')} role="status">
          {t('settings.remote.thisDevice.desktop.hostError', { error: props.hostError })}
        </p>
      )}

      {props.controllers.length === 0 ? (
        <p className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
          {t('settings.remote.thisDevice.desktop.empty')}
        </p>
      ) : (
        <ul className="rounded-[inherit]">
          {props.controllers.map((controller) => {
            const name = controller.label || t('settings.remote.thisDevice.desktop.title')
            return (
              <li key={controller.id}>
                <DeviceRow
                  kind={computerKind(controller.platform)}
                  name={name}
                  online={controller.path !== null}
                  path={controller.path}
                  status={controller.enabled
                    ? t('settings.remote.thisDevice.desktop.pairedAt', {
                        date: new Date(controller.pairedAt).toLocaleDateString(),
                      })
                    : t('settings.remote.thisDevice.desktop.accessOff')}
                  removeLabel={t('resources.remote.remove')}
                  onRemove={() => props.onRemove(controller)}
                  access={{
                    enabled: controller.enabled,
                    label: t('settings.remote.thisDevice.desktop.allow', { name }),
                    onChange: (enabled) => props.onSetEnabled(controller, enabled),
                  }}
                  accessLocked={!props.controlAllowed}
                />
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
