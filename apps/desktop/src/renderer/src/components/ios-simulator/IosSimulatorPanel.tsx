import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type {
  IosSimulatorDevice,
  IosSimulatorSessionState,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'
import { Button } from '@superone/ui/components/ui/button'
import { IosSimulatorStage } from './IosSimulatorStage'
import { readRecentUdids, resolveRecentDevices } from './ios-simulator-recents'
import { useIosSimulatorTabActions } from './ios-simulator-tab-actions'
import { messageOf, notifyIosSimulator, reportIosSimulatorError } from './ios-simulator-report'

interface IosSimulatorPanelProps {
  sessionId: string
  /** `preview` / `overlay` reshape the stage around the device — see `IosSimulatorStage`. */
  variant?: 'panel' | 'preview' | 'overlay'
}

export function IosSimulatorPanel({ sessionId, variant }: IosSimulatorPanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<IosSimulatorStatus | null>(null)
  const [devices, setDevices] = useState<IosSimulatorDevice[]>([])
  const [selectedUdid, setSelectedUdid] = useState('')
  const [sessionState, setSessionState] = useState<IosSimulatorSessionState | null>(null)
  // One view, always the stage. Nothing boots until a device is chosen from the
  // header menu, so opening the panel still does not commandeer a simulator — it
  // just shows an empty stage with that menu instead of a page of its own.
  const [operation, setOperation] = useState<'loading' | 'booting' | null>('loading')

  // Read by `refresh`, which the mount effect depends on: taking `selectedUdid` as a
  // real dependency there would re-run the panel-open restore pass on every device
  // switch, and the restore pass fights the user for which device is on screen.
  const selectedUdidRef = useRef(selectedUdid)
  useEffect(() => { selectedUdidRef.current = selectedUdid }, [selectedUdid])

  /**
   * Point the panel at a device without starting it. Booting is always the user's
   * call, made on the device's own glass — so the only thing done silently here is
   * stepping into a simulator that is already up and unclaimed, which starts nothing.
   */
  const preview = useCallback(async (target: IosSimulatorDevice | null) => {
    setSelectedUdid(target?.udid ?? '')
    setSessionState(
      target?.booted && !target.boundSessionId
        ? await window.environment.iosSimulatorBind(sessionId, target.udid)
        : null,
    )
  }, [sessionId])

  /**
   * `restore` is the panel-open pass. It is the only one allowed to reach for the
   * REMEMBERED simulator: a manual Refresh right after a deliberate Disconnect would
   * otherwise walk straight back onto the device the user just let go of. What is
   * already on screen survives either way — re-reading the list is how you pick up a
   * simulator Xcode just created, and losing your place for it would be absurd.
   */
  const refresh = useCallback(async (force = false, restore = false) => {
    setOperation('loading')
    try {
      const nextStatus = await window.environment.iosSimulatorStatus(force)
      setStatus(nextStatus)
      if (!nextStatus.supported) {
        setDevices([])
        setSelectedUdid('')
        setSessionState(null)
        return
      }
      const nextDevices = await window.environment.iosSimulatorList()
      setDevices(nextDevices)

      const bound = nextDevices.find((device) => device.boundSessionId === sessionId)
      if (!bound) {
        setSessionState(null)
        // Whatever is on screen stays on screen, as long as it still exists. Only an
        // empty panel reaches for the remembered simulator, and only on open: showing
        // a device is not the same as taking it, so a shut-down one is merely drawn,
        // with its own Launch button.
        const held = nextDevices.find((device) => device.udid === selectedUdidRef.current) ?? null
        const recent = restore ? resolveRecentDevices(readRecentUdids(), nextDevices)[0] ?? null : null
        await preview(held ?? recent)
        return
      }
      setSelectedUdid(bound.udid)
      const state = await window.environment.iosSimulatorBind(sessionId, bound.udid)
      setSessionState(state)
    } catch (cause) {
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [preview, sessionId])

  useEffect(() => {
    void refresh(false, true)
  }, [refresh])

  // Refresh lives on the dockview tab, not in this panel's header: it acts on the
  // device list rather than on the device, and the header's pixels belong to the
  // device. The tab only draws it while it is the active tab, so at rest it costs
  // nothing at all.
  const register = useIosSimulatorTabActions((state) => state.register)
  const unregister = useIosSimulatorTabActions((state) => state.unregister)
  useEffect(() => {
    register(sessionId, { refresh: () => { void refresh(true) }, busy: operation === 'loading' })
    return () => unregister(sessionId)
  }, [operation, refresh, register, sessionId, unregister])

  const selectedDevice = useMemo(
    () => devices.find((device) => device.udid === selectedUdid) ?? null,
    [devices, selectedUdid],
  )

  /**
   * Menu pick. Whatever this session held is given up first — it keeps running, just
   * unowned — because otherwise the panel would show one device while the binding,
   * and so Disconnect and Shut Down, still pointed at another.
   */
  const select = useCallback(async (udid: string) => {
    if (udid === selectedUdid) return
    setOperation('loading')
    try {
      if (sessionState?.device) await window.environment.iosSimulatorDetach(sessionId)
      setSessionState(null)
      const nextDevices = await window.environment.iosSimulatorList()
      setDevices(nextDevices)
      await preview(nextDevices.find((device) => device.udid === udid) ?? null)
    } catch (cause) {
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [preview, selectedUdid, sessionId, sessionState])

  const launch = useCallback(async (udid: string) => {
    // Drop the old state before the new device answers. `boot` rebinds the session
    // for us, but until it returns `sessionState` still describes the device being
    // left — and the stage would go on streaming and drawing chrome for it.
    if (udid !== selectedUdid) setSessionState(null)
    setSelectedUdid(udid)
    setOperation('booting')
    try {
      // `boot` binds the session to the device itself, so no separate bind call.
      const next = await window.environment.iosSimulatorBoot(sessionId, udid)
      setSessionState(next)
      setDevices(await window.environment.iosSimulatorList())
    } catch (cause) {
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [selectedUdid, sessionId])

  /**
   * Both endings drop the binding, so both leave the stage empty with its device menu
   * ready. Detach leaves the device running and unowned; terminate takes it down.
   */
  const finish = useCallback(async (mode: 'detach' | 'terminate') => {
    setOperation('loading')
    try {
      await (mode === 'detach'
        ? window.environment.iosSimulatorDetach(sessionId)
        : window.environment.iosSimulatorShutdown(sessionId))
      setSessionState(null)
      setSelectedUdid('')
      setDevices(await window.environment.iosSimulatorList())
      notifyIosSimulator(t(`activity.iosSimulator.${mode === 'detach' ? 'detached' : 'terminated'}`))
    } catch (cause) {
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [sessionId, t])

  if (status && !status.supported) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-8 text-amber-500" />
          <h2 className="text-sm font-semibold">{t('activity.iosSimulator.unsupportedTitle')}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{status.error || t('activity.iosSimulator.unsupportedDetail')}</p>
          <Button size="sm" variant="outline" onClick={() => { void refresh(true) }}>
            <RefreshCw data-icon />
            {t('activity.iosSimulator.refresh')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <IosSimulatorStage
      sessionId={sessionId}
      variant={variant}
      devices={devices}
      device={selectedDevice}
      sessionState={sessionState}
      busy={operation !== null}
      // The very first pass, before simctl has answered at all. The stage draws a
      // blank device body around the message rather than a bare centred spinner.
      checking={operation === 'loading' && status === null}
      launching={operation === 'booting'}
      onSelectDevice={(udid) => { void select(udid) }}
      onLaunchDevice={(udid) => { void launch(udid) }}
      onDetach={() => { void finish('detach') }}
      onTerminate={() => { void finish('terminate') }}
    />
  )
}
