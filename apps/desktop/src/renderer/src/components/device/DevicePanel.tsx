import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { DeviceDescriptor, DeviceState } from '@superone/shared/device'
import type { IosSimulatorStatus } from '@superone/shared/ios-simulator'
import { Button } from '@superone/ui/components/ui/button'
import { DeviceStage } from './DeviceStage'
import { readRecentDeviceIds, resolveRecentDevices } from './device-recents'
import { useDeviceTabActions } from './device-tab-actions'
import { messageOf, notifyDevice, reportDeviceError } from './device-report'

interface DevicePanelProps {
  sessionId: string
  /** `preview` / `overlay` reshape the stage around the device — see `DeviceStage`. */
  variant?: 'panel' | 'preview' | 'overlay'
}

export function DevicePanel({ sessionId, variant }: DevicePanelProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<IosSimulatorStatus | null>(null)
  const [devices, setDevices] = useState<DeviceDescriptor[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [sessionState, setSessionState] = useState<DeviceState | null>(null)
  // One view, always the stage. Nothing boots until a device is chosen from the
  // header menu, so opening the panel still does not commandeer a simulator — it
  // just shows an empty stage with that menu instead of a page of its own.
  const [operation, setOperation] = useState<'loading' | 'booting' | null>('loading')

  // Read by `refresh`, which the mount effect depends on: taking `selectedDeviceId` as a
  // real dependency there would re-run the panel-open restore pass on every device
  // switch, and the restore pass fights the user for which device is on screen.
  const selectedIdRef = useRef(selectedDeviceId)
  useEffect(() => { selectedIdRef.current = selectedDeviceId }, [selectedDeviceId])

  /**
   * Point the panel at a device without starting it. Booting is always the user's
   * call, made on the device's own glass — so the only thing done silently here is
   * stepping into a device that is already up and unclaimed, which starts nothing.
   */
  const preview = useCallback(async (target: DeviceDescriptor | null) => {
    setSelectedDeviceId(target?.id ?? '')
    setSessionState(
      target?.running && !target.boundSessionId
        ? await window.environment.deviceBind(sessionId, target.id)
        : null,
    )
  }, [sessionId])

  /**
   * `restore` is the panel-open pass. It is the only one allowed to reach for the
   * REMEMBERED device: a manual Refresh right after a deliberate Disconnect would
   * otherwise walk straight back onto the device the user just let go of. What is
   * already on screen survives either way — re-reading the list is how you pick up a
   * simulator Xcode just created or a phone that was just plugged in, and losing your
   * place for it would be absurd.
   */
  const refresh = useCallback(async (force = false, restore = false) => {
    setOperation('loading')
    try {
      // Both, always, and in parallel. The device list spans platforms, so it is
      // the answer to "is there anything to show"; the Xcode probe only explains an
      // EMPTY list on a Mac without one, and gating the list behind it would hide
      // every Android device on a machine that has no Xcode at all.
      const [nextStatus, nextDevices] = await Promise.all([
        window.environment.iosSimulatorStatus(force),
        window.environment.deviceList(),
      ])
      setStatus(nextStatus)
      setDevices(nextDevices)

      const bound = nextDevices.find((device) => device.boundSessionId === sessionId)
      if (!bound) {
        setSessionState(null)
        // Whatever is on screen stays on screen, as long as it still exists. Only an
        // empty panel reaches for the remembered simulator, and only on open: showing
        // a device is not the same as taking it, so a shut-down one is merely drawn,
        // with its own Launch button.
        const held = nextDevices.find((device) => device.id === selectedIdRef.current) ?? null
        const recent = restore ? resolveRecentDevices(readRecentDeviceIds(), nextDevices)[0] ?? null : null
        await preview(held ?? recent)
        return
      }
      setSelectedDeviceId(bound.id)
      const state = await window.environment.deviceBind(sessionId, bound.id)
      setSessionState(state)
    } catch (cause) {
      reportDeviceError(messageOf(cause))
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
  const register = useDeviceTabActions((state) => state.register)
  const unregister = useDeviceTabActions((state) => state.unregister)
  useEffect(() => {
    register(sessionId, { refresh: () => { void refresh(true) }, busy: operation === 'loading' })
    return () => unregister(sessionId)
  }, [operation, refresh, register, sessionId, unregister])

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  )

  /**
   * Menu pick. Whatever this session held is given up first — it keeps running, just
   * unowned — because otherwise the panel would show one device while the binding,
   * and so Disconnect and Shut Down, still pointed at another.
   */
  const select = useCallback(async (deviceId: string) => {
    if (deviceId === selectedDeviceId) return
    setOperation('loading')
    try {
      if (sessionState?.device) await window.environment.deviceDetach(sessionState.deviceId)
      setSessionState(null)
      const nextDevices = await window.environment.deviceList()
      setDevices(nextDevices)
      await preview(nextDevices.find((device) => device.id === deviceId) ?? null)
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [preview, selectedDeviceId, sessionId, sessionState])

  const launch = useCallback(async (deviceId: string) => {
    // Drop the old state before the new device answers. `boot` rebinds the session
    // for us, but until it returns `sessionState` still describes the device being
    // left — and the stage would go on streaming and drawing chrome for it.
    if (deviceId !== selectedDeviceId) setSessionState(null)
    setSelectedDeviceId(deviceId)
    setOperation('booting')
    try {
      // `boot` binds the session to the device itself, so no separate bind call.
      const next = await window.environment.deviceBoot(sessionId, deviceId)
      setSessionState(next)
      setDevices(await window.environment.deviceList())
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [selectedDeviceId, sessionId])

  /**
   * Both endings drop the binding, so both leave the stage empty with its device menu
   * ready. Detach leaves the device running and unowned; terminate takes it down.
   */
  const finish = useCallback(async (mode: 'detach' | 'terminate') => {
    const held = sessionState?.deviceId
    if (!held) return
    setOperation('loading')
    try {
      await (mode === 'detach'
        ? window.environment.deviceDetach(held)
        : window.environment.deviceShutdown(held))
      setSessionState(null)
      setSelectedDeviceId('')
      setDevices(await window.environment.deviceList())
      notifyDevice(t(`activity.device.${mode === 'detach' ? 'detached' : 'terminated'}`))
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    } finally {
      setOperation(null)
    }
  }, [sessionState, t])

  // Only when the list is ALSO empty. On a Mac with no Xcode but an Android SDK the
  // panel has real devices to offer, and a page saying iOS is unavailable would be
  // both true and useless.
  if (status && !status.supported && devices.length === 0 && operation === null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-8 text-amber-500" />
          <h2 className="text-sm font-semibold">{t('activity.device.unsupportedTitle')}</h2>
          <p className="text-xs leading-5 text-muted-foreground">{status.error || t('activity.device.unsupportedDetail')}</p>
          <Button size="sm" variant="outline" onClick={() => { void refresh(true) }}>
            <RefreshCw data-icon />
            {t('activity.device.refresh')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DeviceStage
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
      canCreateSimulator={status?.supported === true}
      onSelectDevice={(deviceId) => { void select(deviceId) }}
      onLaunchDevice={(deviceId) => { void launch(deviceId) }}
      onDetach={() => { void finish('detach') }}
      onTerminate={() => { void finish('terminate') }}
    />
  )
}
