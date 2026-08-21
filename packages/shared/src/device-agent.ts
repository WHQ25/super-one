/**
 * What an agent sees and does on a touch device.
 *
 * Deliberately device-neutral: an iOS Simulator is the only backend today, but
 * nothing here names it, so adding Android means adding a backend rather than a
 * second vocabulary for the agent to learn.
 */

/**
 * `[x, y, width, height]`, as fractions of the device's framebuffer.
 *
 * Normalized rather than in points because that is the space touch input speaks,
 * and because it is the one space that does not change under rotation, display
 * scale, or a resized preview. Converting the guest's own point coordinates into
 * this is the backend's job.
 */
export type DeviceUiBounds = readonly [x: number, y: number, width: number, height: number]

/** A node in a UI snapshot. `ref` is only meaningful within its own snapshot. */
export interface DeviceUiNode {
  /** `@eN`, valid until the next snapshot. See `DeviceUiSnapshot.stateId`. */
  ref: string
  role: string
  label?: string
  value?: string
  /**
   * The developer-assigned identity (`accessibilityIdentifier` on iOS).
   *
   * The most durable way to name a control in a first-party app: unlike `label` it
   * survives copy changes and does not vary by language.
   */
  identifier?: string
  enabled?: boolean
  focused?: boolean
  bounds?: DeviceUiBounds
  children?: DeviceUiNode[]
  /** Children dropped by the node budget. Present only when something was cut. */
  truncatedChildren?: number
}

export type DeviceOrientation =
  | 'portrait'
  | 'landscape-left'
  | 'portrait-upside-down'
  | 'landscape-right'

export interface DeviceUiSnapshot {
  /**
   * Names both the observation and the generation of refs it handed out. Actions
   * quote it so one built against a screen that has since changed is rejected
   * rather than landing on whatever now occupies the same slot.
   */
  stateId: string
  orientation: DeviceOrientation
  /** Framebuffer size in pixels. */
  screen: { width: number; height: number }
  root?: DeviceUiNode
  /** Saved image, when the snapshot captured pixels. Never inlined as base64. */
  image?: { path: string; width: number; height: number }
  /**
   * Whether the UI stopped changing before the snapshot was taken.
   *
   * False means it was captured mid-animation and the geometry may already be
   * stale — the single most common reason a tap lands on the wrong control.
   */
  settled: boolean
  /** Set when the node budget cut the tree short. */
  truncated?: boolean
}
