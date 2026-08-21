import type { DeviceUiBounds, DeviceUiNode } from '@superone/shared/device-agent'
import {
  IOS_SIMULATOR_ROTATION_DEGREES,
  type IosSimulatorOrientation,
} from '@superone/shared/ios-simulator'

/** A node exactly as `accessibility.dump` emits it. Frames are guest POINTS. */
export interface IosSimulatorRawNode {
  uid: number
  role?: string
  subrole?: string
  label?: string
  value?: string
  identifier?: string
  enabled?: boolean
  focused?: boolean
  /** `[x, y, width, height]` in guest points, already rotated with the device. */
  frame?: [number, number, number, number]
  children?: IosSimulatorRawNode[]
  truncatedChildren?: number
}

export interface IosSimulatorAccessibilityDump {
  generation: number
  nodes: number
  complete: boolean
  tree: IosSimulatorRawNode
}

export interface NormalizedAccessibilityTree {
  root: DeviceUiNode
  /** `@eN` -> the helper uid that names the same element. */
  refs: Map<string, number>
  /** The guest's own screen size in points, taken from the root frame. */
  screenPoints: { width: number; height: number }
}

/**
 * Guest point space and framebuffer space are NOT the same space.
 *
 * The framebuffer never changes shape — the guest draws its rotated UI into the same
 * portrait surface, exactly like a real panel — while accessibility frames come back
 * in the rotated screen's own coordinates. In landscape the two are a quarter turn
 * apart, so reading a frame as if it were a touch position puts every tap on the
 * wrong edge of the screen.
 *
 * Measured, not derived: a landscape Safari screenshot was compared against the
 * frames of its address bar and Favorites heading in both landscape orientations.
 * Deriving it from the names is exactly how this ends up 180 degrees out — Apple's
 * `landscapeLeft` describes where the home button lands, not which way the device
 * turned.
 */
export function guestToFramebufferPoint(
  u: number,
  v: number,
  orientation: IosSimulatorOrientation,
): [number, number] {
  switch (IOS_SIMULATOR_ROTATION_DEGREES[orientation]) {
    case 90: return [v, 1 - u]
    case 180: return [1 - u, 1 - v]
    case 270: return [1 - v, u]
    default: return [u, v]
  }
}

/**
 * A rotated rectangle is still a rectangle, but its corners swap roles, so the
 * origin has to be recomputed from both rather than transformed on its own.
 */
export function guestToFramebufferBounds(
  frame: readonly [number, number, number, number],
  screenPoints: { width: number; height: number },
  orientation: IosSimulatorOrientation,
): DeviceUiBounds | undefined {
  const [x, y, width, height] = frame
  if (!(screenPoints.width > 0) || !(screenPoints.height > 0)) return undefined

  const [ax, ay] = guestToFramebufferPoint(x / screenPoints.width, y / screenPoints.height, orientation)
  const [bx, by] = guestToFramebufferPoint(
    (x + width) / screenPoints.width,
    (y + height) / screenPoints.height,
    orientation,
  )
  const round = (value: number) => Math.round(value * 1e4) / 1e4
  return [round(Math.min(ax, bx)), round(Math.min(ay, by)), round(Math.abs(bx - ax)), round(Math.abs(by - ay))]
}

/**
 * Turn one helper dump into the agent-facing tree.
 *
 * Refs are assigned in traversal order rather than reusing the helper's uids: uids
 * are an implementation detail of one process, while `@eN` is what the agent quotes
 * back, and keeping the mapping here means the tool layer never has to care which
 * backend produced the tree.
 */
export function normalizeAccessibilityTree(
  dump: IosSimulatorAccessibilityDump,
  orientation: IosSimulatorOrientation,
): NormalizedAccessibilityTree {
  const rootFrame = dump.tree.frame
  const screenPoints = {
    width: rootFrame?.[2] ?? 0,
    height: rootFrame?.[3] ?? 0,
  }
  const refs = new Map<string, number>()
  let next = 0

  const convert = (raw: IosSimulatorRawNode): DeviceUiNode => {
    const ref = `@e${next++}`
    refs.set(ref, raw.uid)
    const node: DeviceUiNode = { ref, role: raw.role ?? 'unknown' }
    if (raw.label) node.label = raw.label
    if (raw.value) node.value = raw.value
    if (raw.identifier) node.identifier = raw.identifier
    if (raw.enabled === false) node.enabled = false
    if (raw.focused === true) node.focused = true
    if (raw.frame) {
      const bounds = guestToFramebufferBounds(raw.frame, screenPoints, orientation)
      if (bounds) node.bounds = bounds
    }
    if (raw.children?.length) node.children = raw.children.map(convert)
    if (raw.truncatedChildren) node.truncatedChildren = raw.truncatedChildren
    return node
  }

  return { root: convert(dump.tree), refs, screenPoints }
}

/**
 * A stable summary of what the screen currently shows, for settle detection.
 *
 * Positions are quantised to roughly 2px of a phone framebuffer on purpose: the last
 * frames of an iOS spring animation land within a fraction of a pixel of their
 * target, and comparing raw floats would report motion nobody could see and let the
 * settle loop run to its timeout on a screen that is, to any observer, still.
 */
export function fingerprintTree(root: DeviceUiNode): string {
  const parts: string[] = []
  const walk = (node: DeviceUiNode) => {
    const bounds = node.bounds ? node.bounds.map((value) => Math.round(value * 500)).join(',') : ''
    parts.push(`${node.role}|${node.label ?? ''}|${node.value ?? ''}|${bounds}`)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return parts.join('\n')
}

/** Depth-first search over a normalized tree. Used by `device_query`. */
export function findNode(
  root: DeviceUiNode,
  predicate: (node: DeviceUiNode) => boolean,
): DeviceUiNode | undefined {
  if (predicate(root)) return root
  for (const child of root.children ?? []) {
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return undefined
}

export function collectNodes(root: DeviceUiNode): DeviceUiNode[] {
  const out: DeviceUiNode[] = []
  const walk = (node: DeviceUiNode) => {
    out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}
