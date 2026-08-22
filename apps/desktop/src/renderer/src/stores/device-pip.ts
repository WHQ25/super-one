/**
 * Where each session's device picture should be drawn, and which surface wins.
 *
 * The picture itself is not here and is not in the React tree that shows it: exactly
 * one `DevicePanel` per session lives permanently in `DeviceHostLayer`,
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
 * Keyed by chat session rather than by device: a session owns at most one device,
 * and the preview follows the conversation the user is looking at — switching away
 * hides it without tearing anything down.
 *
 * `hiddenSessionId` is a dismissal, not a teardown. The device stays bound; the user
 * only said they do not want to watch it. Anything that makes the preview meaningful
 * again (a fresh grant, opening the panel) clears it.
 */

import { create } from 'zustand'
import type { DevicePlatform } from '@superone/shared/device'
import { withoutKey } from '@/lib/record'

export interface DevicePipDevice {
  /** Platform-carrying handle, so the preview can tell which artwork to look for. */
  id: string
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

  /** The session whose device is bound and ready — the reason a preview exists at all. */
  readySessionId: string | null
  expandedSessionId: string | null
  hiddenSessionId: string | null
  /**
   * The bound device, as the preview box needs to know it: which simulator to read
   * artwork for, and its glass already turned the way the device is lying. The box is
   * the device and nothing else, so between them these are the box's shape.
   */
  device: DevicePipDevice | null

  updateSlot: (sessionId: string, mode: DeviceSlotMode, rect: DOMRectReadOnly) => void
  unregisterSlot: (sessionId: string, mode: DeviceSlotMode) => void
  setReady: (sessionId: string | null, device?: DevicePipDevice | null) => void
  hidePreview: (sessionId: string) => void
  expandPreview: (sessionId: string) => void
  shrinkPreview: () => void
}

export const useDevicePipStore = create<DevicePipState>()((set) => ({
  slots: {},
  pipSlots: {},
  overlaySlots: {},
  readySessionId: null,
  expandedSessionId: null,
  hiddenSessionId: null,
  device: null,

  // A new grant is a new intent to watch, so it un-dismisses. Losing the device
  // clears the expanded state too, or the overlay would sit over nothing.
  setReady: (sessionId, device = null) => set((state) => ({
    readySessionId: sessionId,
    hiddenSessionId: sessionId && state.hiddenSessionId === sessionId ? null : state.hiddenSessionId,
    expandedSessionId: sessionId ? state.expandedSessionId : null,
    // Same device on a republish must be the same object, or every host push — a
    // rotation, a keyboard toggle — would remeasure the box and fight a drag.
    device: sameDevice(state.device, device) ? state.device : device,
  })),
  updateSlot: (sessionId, mode, rect) =>
    set((state) => {
      const target = slotsFor(state, mode)
      const prev = target[sessionId]
      const left = Math.round(rect.left), top = Math.round(rect.top)
      const width = Math.round(rect.width), height = Math.round(rect.height)
      // A rect is re-read on every animation frame while anything is moving, and an
      // unchanged one must not re-render the host — it would fight a drag.
      if (prev && prev.mode === mode && prev.left === left && prev.top === top
        && prev.width === width && prev.height === height) return state
      return withSlots(mode, { ...target, [sessionId]: { mode, left, top, width, height } })
    }),
  unregisterSlot: (sessionId, mode) =>
    set((state) => {
      const target = slotsFor(state, mode)
      // Only the surface that owns this mode may drop it. Otherwise a placeholder
      // unmounting after its successor registered would take the successor's slot.
      if (target[sessionId]?.mode !== mode) return state
      return withSlots(mode, withoutKey(target, sessionId))
    }),
  hidePreview: (sessionId) => set({ hiddenSessionId: sessionId, expandedSessionId: null }),
  expandPreview: (sessionId) => set({ expandedSessionId: sessionId }),
  shrinkPreview: () => set({ expandedSessionId: null }),
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
 * Every session that needs a live panel — which is NOT the same as every session with
 * something on screen.
 *
 * A slot means some surface is asking to draw this session's device right now. The
 * ready session is here as well because there are two moments with no slot at all and
 * a device that must survive them: the beat between the preview unregistering and the
 * Activity tab mounting, and the whole time the user is in Settings, where neither
 * surface exists. Membership is what keeps the panel — and so the decoder — alive
 * across both.
 *
 * A dismissed preview is deliberately excluded. The device stays bound, but the user
 * has said they do not want to watch it, and holding a decoder open to draw nothing
 * costs real CPU.
 */
export function selectHostedDeviceSessions(state: DevicePipState): string[] {
  const hosted = new Set([
    ...Object.keys(state.slots),
    ...Object.keys(state.pipSlots),
    ...Object.keys(state.overlaySlots),
  ])
  if (state.readySessionId && state.readySessionId !== state.hiddenSessionId) {
    hosted.add(state.readySessionId)
  }
  return [...hosted]
}
