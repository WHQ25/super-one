/**
 * The standing "agents may drive this device" answer, as the device tab sees it.
 *
 * The grant is normally given in chat — the permission prompt's Always Allow — which
 * is the right place to give one and the wrong place to find it later. This is the
 * other half: the device tab already names one device and is where the user goes to
 * look at it, so it is where taking the answer back belongs.
 *
 * There are only two states because there are only two answers. "This chat only" is
 * the default accept and stores nothing — the binding it produces dies with the
 * session — so the toggle is genuinely binary: standing, or ask every time.
 *
 * Kept apart from `DeviceMenu` so the menu stays chrome, and because the main process
 * re-reads settings on every grant check: a flip here is live on the next tool call
 * with nothing to invalidate.
 */

import { useCallback, useEffect, useState } from 'react'
import type { DeviceControlGrant } from '@superone/shared/agent-types'
import type { DeviceDescriptor } from '@superone/shared/device'

export interface DeviceAgentGrantControl {
  /** Whether this device may be taken by any session without a prompt. */
  isGranted: (deviceId: string) => boolean
  /** Give or take back the standing answer. */
  setGranted: (device: DeviceDescriptor, granted: boolean) => Promise<void>
}

function readGrants(settings: unknown): DeviceControlGrant[] {
  const list = (settings as { deviceControlGrants?: DeviceControlGrant[] } | null)
    ?.deviceControlGrants
  return Array.isArray(list) ? list : []
}

export function useDeviceAgentGrant(): DeviceAgentGrantControl {
  const [grants, setGrants] = useState<DeviceControlGrant[]>([])

  useEffect(() => {
    let cancelled = false
    void window.app.getAppSettings().then((settings) => {
      if (!cancelled) setGrants(readGrants(settings))
    })
    // Settings also change from the permission prompt answering "always", which is the
    // common way one appears. Without this the tab would keep showing "ask every time"
    // for a device the user just granted from the chat next to it.
    const stop = window.app.onAppSettingsChange?.((settings) => {
      setGrants(readGrants(settings))
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  const isGranted = useCallback(
    (deviceId: string) => grants.some((grant) => grant.deviceId === deviceId),
    [grants],
  )

  const setGranted = useCallback(async (device: DeviceDescriptor, granted: boolean) => {
    const without = grants.filter((grant) => grant.deviceId !== device.id)
    const next = granted
      ? [...without, {
          deviceId: device.id,
          deviceName: device.name,
          ...(device.platformVersion ? { platformVersion: device.platformVersion } : {}),
        }]
      : without
    const settings = await window.app.saveAppSettings({ deviceControlGrants: next })
    setGrants(readGrants(settings))
  }, [grants])

  return { isGranted, setGranted }
}
