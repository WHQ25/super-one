/**
 * Where each open device tab's picture should be drawn, and which surface wins.
 *
 * The picture itself is not here and is not in the React tree that shows it: exactly
 * one `DevicePanel` per INSTANCE lives permanently in `DeviceHostLayer`,
 * and the Activity tab and the floating preview only MEASURE themselves and report a
 * rect. This store is the meeting point — the surfaces write slots into it, the host
 * layer reads them and positions the one panel over the winner.
 *
 * That indirection is the whole point. The two surfaces sit in different branches of
 * the tree and cannot share a position in it, so rendering the panel in both meant
 * React unmounting one and mounting the other on every switch. The arriving panel
 * started empty and had to re-read the device list before it could show anything,
 * which is the half-second of black glass the handover used to cost.
 *
 * Keyed by INSTANCE — the tab, not the session and not the device. A session can
 * have two devices open at once, so a session key would collide; a device key would
 * change under a tab whose device the user swapped, taking its slot with it. See
 * `stores/device-instances`.
 *
 * `hiddenInstanceId` is a dismissal, not a teardown. The device stays bound; the user
 * only said they do not want to watch it. Anything that makes the preview meaningful
 * again (a fresh grant, opening the panel) clears it.
 */

import { create } from 'zustand'
import type { DeviceProvider, DevicePlatform } from '@superone/shared/device'
import { withoutKey } from '@/lib/record'

export interface DevicePipDevice {
  /** Provider-carrying handle, so the preview can tell which artwork to look for. */
  id: string
  /** How it is reached — the axis artwork and rotation actually key on. */
  provider: DeviceProvider
  platform: DevicePlatform
  /** The guest's glass, already turned. Zero when nothing has attached yet. */
  width: number
  height: number
}

/** Panel = the Activity tab, pip = the floating preview, overlay = it expanded. */
export type DeviceSlotMode = 'panel' | 'pip' | 'overlay'

/** Where a surface is, in viewport coordinates, for the host layer to sit on. */
export interface DeviceSlot {
  mode: DeviceSlotMode
  left: number
  top: number
  width: number
  height: number
}

interface DevicePipState {
  /** Dockview-owned geometry. Kept while the preview is up so it can be gone back to. */
  slots: Record<string, DeviceSlot>
  pipSlots: Record<string, DeviceSlot>
  overlaySlots: Record<string, DeviceSlot>

  /** The instance whose device is bound and ready — the reason a preview exists at all. */
  readyInstanceId: string | null
  expandedInstanceId: string | null
  hiddenInstanceId: string | null
  /**
   * The bound device, as the preview box needs to know it: which simulator to read
   * artwork for, and its glass already turned the way the device is lying. The box is
   * the device and nothing else, so between them these are the box's shape.
   */
  device: DevicePipDevice | null

  updateSlot: (instanceId: string, mode: DeviceSlotMode, rect: DOMRectReadOnly) => void
  unregisterSlot: (instanceId: string, mode: DeviceSlotMode) => void
  setReady: (instanceId: string | null, device?: DevicePipDevice | null) => void
  hidePreview: (instanceId: string) => void
  expandPreview: (instanceId: string) => void
  shrinkPreview: () => void
}

export const useDevicePipStore = create<DevicePipState>()((set) => ({
  slots: {},
  pipSlots: {},
  overlaySlots: {},
  readyInstanceId: null,
  expandedInstanceId: null,
  hiddenInstanceId: null,
  device: null,

  // A new grant is a new intent to watch, so it un-dismisses. Losing the device
  // clears the expanded state too, or the overlay would sit over nothing.
  setReady: (instanceId, device = null) => set((state) => ({
    readyInstanceId: instanceId,
    hiddenInstanceId: instanceId && state.hiddenInstanceId === instanceId ? null : state.hiddenInstanceId,
    expandedInstanceId: instanceId ? state.expandedInstanceId : null,
    // Same device on a republish must be the same object, or every host push — a
    // rotation, a keyboard toggle — would remeasure the box and fight a drag.
    device: sameDevice(state.device, device) ? state.device : device,
  })),
  updateSlot: (instanceId, mode, rect) =>
    set((state) => {
      const target = slotsFor(state, mode)
      const prev = target[instanceId]
      const left = Math.round(rect.left), top = Math.round(rect.top)
      const width = Math.round(rect.width), height = Math.round(rect.height)
      // A rect is re-read on every animation frame while anything is moving, and an
      // unchanged one must not re-render the host — it would fight a drag.
      if (prev && prev.mode === mode && prev.left === left && prev.top === top
        && prev.width === width && prev.height === height) return state
      return withSlots(mode, { ...target, [instanceId]: { mode, left, top, width, height } })
    }),
  unregisterSlot: (instanceId, mode) =>
    set((state) => {
      const target = slotsFor(state, mode)
      // Only the surface that owns this mode may drop it. Otherwise a placeholder
      // unmounting after its successor registered would take the successor's slot.
      if (target[instanceId]?.mode !== mode) return state
      return withSlots(mode, withoutKey(target, instanceId))
    }),
  hidePreview: (instanceId) => set({ hiddenInstanceId: instanceId, expandedInstanceId: null }),
  expandPreview: (instanceId) => set({ expandedInstanceId: instanceId }),
  shrinkPreview: () => set({ expandedInstanceId: null }),
}))

function sameDevice(a: DevicePipDevice | null, b: DevicePipDevice | null): boolean {
  if (!a || !b) return a === b
  return a.id === b.id && a.width === b.width && a.height === b.height
}

function slotsFor(
  state: Pick<DevicePipState, 'slots' | 'pipSlots' | 'overlaySlots'>,
  mode: DeviceSlotMode,
): Record<string, DeviceSlot> {
  return mode === 'pip' ? state.pipSlots : mode === 'overlay' ? state.overlaySlots : state.slots
}

function withSlots(
  mode: DeviceSlotMode,
  next: Record<string, DeviceSlot>,
): Partial<DevicePipState> {
  return mode === 'pip' ? { pipSlots: next } : mode === 'overlay' ? { overlaySlots: next } : { slots: next }
}

/**
 * Every instance that needs a live panel — which is NOT the same as every instance
 * with something on screen.
 *
 * A slot means some surface is asking to draw this tab's device right now. The ready
 * instance is here as well because there are two moments with no slot at all and a
 * device that must survive them: the beat between the preview unregistering and the
 * Activity tab mounting, and the whole time the user is in Settings, where neither
 * surface exists. Membership is what keeps the panel — and so the decoder — alive
 * across both.
 *
 * A dismissed preview is deliberately excluded. The device stays bound, but the user
 * has said they do not want to watch it, and holding a decoder open to draw nothing
 * costs real CPU.
 */
export function selectHostedDeviceInstances(state: DevicePipState): string[] {
  const hosted = new Set([
    ...Object.keys(state.slots),
    ...Object.keys(state.pipSlots),
    ...Object.keys(state.overlaySlots),
  ])
  if (state.readyInstanceId && state.readyInstanceId !== state.hiddenInstanceId) {
    hosted.add(state.readyInstanceId)
  }
  return [...hosted]
}
