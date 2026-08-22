/**
 * The device tabs that are open, and what each one is pointed at.
 *
 * An INSTANCE is a place to watch a device from — a dock tab, or the floating
 * preview. It is deliberately not the device: a tab keeps its identity when the user
 * picks a different device in it, exactly the way a browser tab keeps its identity
 * when the URL changes. Keying the dock panel on the device instead would mean
 * removing and re-adding the panel on every pick, losing its position in the tab
 * strip, its group, and the focus.
 *
 * This is also the only thing that knows a session has TWO devices open. A chat
 * session testing a client build against a merchant build has one instance per app,
 * and it is the pair of records here — not anything the main process could answer —
 * that stops the second tab from offering the device the first one is already on.
 *
 * `instanceId` never leaves the renderer. Every IPC call names the deviceId; the
 * main process has no concept of a tab and does not need one.
 */

import { create } from 'zustand'
import { withoutKey } from '@/lib/record'

export interface DeviceInstance {
  instanceId: string
  /** The chat session this tab belongs to. Ownership is still granted per session. */
  sessionId: string
  /** What it is pointed at, or null while its stage is empty and showing the picker. */
  deviceId: string | null
}

interface DeviceInstanceState {
  byId: Record<string, DeviceInstance>
  /** Opens a place to watch a device from, and answers with its id. */
  open: (sessionId: string, deviceId?: string | null) => string
  /** Points an existing tab at another device — or at none. */
  point: (instanceId: string, deviceId: string | null) => void
  close: (instanceId: string) => void
}

export const useDeviceInstanceStore = create<DeviceInstanceState>()((set) => ({
  byId: {},

  open: (sessionId, deviceId = null) => {
    const instanceId = crypto.randomUUID()
    set((state) => ({
      byId: { ...state.byId, [instanceId]: { instanceId, sessionId, deviceId } },
    }))
    return instanceId
  },

  point: (instanceId, deviceId) => set((state) => {
    const current = state.byId[instanceId]
    if (!current || current.deviceId === deviceId) return state
    return { byId: { ...state.byId, [instanceId]: { ...current, deviceId } } }
  }),

  close: (instanceId) => set((state) => (
    instanceId in state.byId ? { byId: withoutKey(state.byId, instanceId) } : state
  )),
}))

/** The instance watching this device, if any. Devices are never shared between two. */
export function instanceHolding(
  byId: Record<string, DeviceInstance>,
  deviceId: string,
): DeviceInstance | undefined {
  return Object.values(byId).find((instance) => instance.deviceId === deviceId)
}

/**
 * Devices some OTHER tab is already on, so this one's picker can grey them out.
 *
 * Across every session, not just this one. A device another session holds is already
 * refused by `boundSessionId`, but a device merely POINTED at — drawn, not yet booted
 * — carries no ownership for main to report, and two tabs drawing the same shut-down
 * simulator is a pair the user cannot tell apart.
 */
export function devicesTakenByOtherInstances(
  byId: Record<string, DeviceInstance>,
  instanceId: string,
): string[] {
  return Object.values(byId)
    .filter((instance) => instance.instanceId !== instanceId && instance.deviceId != null)
    .map((instance) => instance.deviceId!)
}
