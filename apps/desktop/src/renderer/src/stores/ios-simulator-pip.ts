import { create } from 'zustand'

export interface IosSimulatorPipDevice {
  udid: string
  /** The guest's glass, already turned. Zero when the helper has not attached yet. */
  width: number
  height: number
}

/**
 * Which session's simulator preview floats over the chat, and how.
 *
 * Keyed by chat session rather than by device: a session owns at most one simulator,
 * and the preview follows the conversation the user is looking at — switching away
 * hides it without tearing anything down.
 *
 * `hiddenSessionId` is a dismissal, not a teardown. The device stays bound; the user
 * only said they do not want to watch it. Anything that makes the preview meaningful
 * again (a fresh grant, opening the panel) clears it.
 */
interface IosSimulatorPipState {
  /** The session whose device is bound and ready — the reason a preview exists at all. */
  readySessionId: string | null
  expandedSessionId: string | null
  hiddenSessionId: string | null
  /**
   * The bound device, as the preview box needs to know it: which simulator to read
   * artwork for, and its glass already turned the way the device is lying. The box is
   * the device and nothing else, so between them these are the box's shape.
   */
  device: IosSimulatorPipDevice | null

  setReady: (sessionId: string | null, device?: IosSimulatorPipDevice | null) => void
  hidePreview: (sessionId: string) => void
  expandPreview: (sessionId: string) => void
  shrinkPreview: () => void
}

export const useIosSimulatorPipStore = create<IosSimulatorPipState>()((set) => ({
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
  hidePreview: (sessionId) => set({ hiddenSessionId: sessionId, expandedSessionId: null }),
  expandPreview: (sessionId) => set({ expandedSessionId: sessionId }),
  shrinkPreview: () => set({ expandedSessionId: null }),
}))

function sameDevice(a: IosSimulatorPipDevice | null, b: IosSimulatorPipDevice | null): boolean {
  if (!a || !b) return a === b
  return a.udid === b.udid && a.width === b.width && a.height === b.height
}
