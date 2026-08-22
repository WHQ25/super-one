/**
 * `uiautomator dump` as the shared `DeviceUiNode` tree.
 *
 * The Android answer to what `AXPTranslator` gives the iOS backend, and the reason
 * everything above the backend seam — refs, `device_query`, conditions, waiting,
 * centre-of-bounds tapping — works on Android for free.
 *
 * It is also the slow part of this platform, measured rather than assumed: 2.4-2.5s
 * per dump against a booted AVD on this machine, with the first call after boot
 * closer to 3.2s. That number is why the Android backend cannot settle the way the
 * iOS one does. iOS samples tree and pixels together every 150ms until both hold
 * still; doing that here would cost ~17 dumps and 40 seconds. The frame hash settles
 * instead, and this runs exactly once on the frame that stopped moving.
 */

import type { DeviceOrientation, DeviceUiNode } from '@superone/shared/device-agent'
import type { NormalizedAccessibilityTree } from '../tree'
import { parseXml, type XmlElement } from './ui-xml'

/**
 * `uiautomator` prints this after the XML when dumping to a stream.
 *
 * The typo is Android's, not a transcription error — the tool has emitted
 * "hierchary" since the beginning, so matching the correct spelling matches nothing.
 * Left as a loose match on the prefix in case it is ever fixed.
 */
const TRAILER = /UI hier\w*y dumped to:.*$/s

export interface UiautomatorTreeOptions {
  /**
   * Framebuffer size in pixels, for converting bounds into ratios.
   *
   * Optional because the root node's own bounds are the screen — but only when the
   * dump is complete. Passing the size known from elsewhere is more reliable.
   */
  screen?: { width: number; height: number }
  /** Ceiling including the root, matching the iOS dump's own budget. */
  maxNodes?: number
}

const DEFAULT_MAX_NODES = 500

/**
 * Android view classes to the role vocabulary the agent already reads.
 *
 * A mapping rather than the raw class name because `android.widget.EditText` and iOS's
 * `textfield` are the same control to anyone deciding what to tap, and an agent that
 * has to learn two names for it will get one of them wrong.
 *
 * Unmapped classes fall back to the last path segment, lowercased, so a custom view
 * still says something ("com.app.ChartView" -> "chartview") instead of "unknown".
 */
const ROLES: Record<string, string> = {
  Button: 'button',
  ImageButton: 'button',
  CompoundButton: 'button',
  TextView: 'text',
  EditText: 'textfield',
  AutoCompleteTextView: 'textfield',
  ImageView: 'image',
  CheckBox: 'checkbox',
  RadioButton: 'radio',
  Switch: 'switch',
  SwitchCompat: 'switch',
  ToggleButton: 'switch',
  SeekBar: 'slider',
  ProgressBar: 'progress',
  RecyclerView: 'list',
  ListView: 'list',
  GridView: 'grid',
  ScrollView: 'scrollview',
  HorizontalScrollView: 'scrollview',
  NestedScrollView: 'scrollview',
  ViewPager: 'pager',
  ViewPager2: 'pager',
  WebView: 'webview',
  Toolbar: 'toolbar',
  TabWidget: 'tablist',
  Spinner: 'combobox',
  FrameLayout: 'group',
  LinearLayout: 'group',
  RelativeLayout: 'group',
  ConstraintLayout: 'group',
  CoordinatorLayout: 'group',
  ViewGroup: 'group',
  View: 'view',
}

/**
 * Roles that describe something to look at, not something to operate.
 *
 * A node with one of these that is nevertheless `clickable` gets promoted to
 * `button`, and that promotion is not cosmetic. Every app icon on the Android home
 * screen is an `android.widget.TextView` with `clickable="true"` — Chrome, Gmail,
 * Phone, all of them. Mapping by class alone hands the agent
 * `{role: 'text', label: 'Chrome'}`, which reads as a caption it cannot press, while
 * the very same icon on iOS is an `AXButton`. Without this, a prompt that works on
 * one platform silently fails on the other.
 */
const PASSIVE_ROLES = new Set(['text', 'image', 'view', 'group', 'unknown'])

export function roleForClass(className: string, clickable = false): string {
  const tail = className.split('.').pop() ?? className
  const role = ROLES[tail] ?? (tail.toLowerCase() || 'unknown')
  return clickable && PASSIVE_ROLES.has(role) ? 'button' : role
}

/** Classes whose `text` is a VALUE the user typed, not a LABEL the app wrote. */
const EDITABLE = new Set(['textfield'])

/**
 * `[left,top][right,bottom]` in pixels.
 *
 * Returns pixels, not ratios: the caller divides, because it is the one that knows
 * the screen size and can tell a bad one from a good one.
 */
export function parseBounds(
  value: string,
): { left: number; top: number; right: number; bottom: number } | null {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value.trim())
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

/**
 * `Surface.ROTATION_*` as the shared orientation vocabulary.
 *
 * Which of the two landscapes each odd value means is a direct reading of the
 * constant order, and it is the one thing here not verified against a device. It is
 * also nearly inconsequential: the only load-bearing question anyone asks an
 * orientation is whether it is landscape (`isDeviceLandscape`), which 1 and 3 answer
 * identically. Unlike iOS, no coordinate transform hangs off this — scrcpy hands over
 * an already-rotated framebuffer, so bounds and pixels agree whatever this says. If a
 * device ever proves the pair backwards, swapping them here is the whole fix.
 */
export function orientationForRotation(rotation: number): DeviceOrientation {
  switch (rotation) {
    case 1: return 'landscape-left'
    case 2: return 'portrait-upside-down'
    case 3: return 'landscape-right'
    default: return 'portrait'
  }
}

/** Strip the trailer uiautomator appends, so what is left is a document. */
export function stripDumpTrailer(output: string): string {
  return output.replace(TRAILER, '').trim()
}

export interface UiautomatorDump {
  tree: NormalizedAccessibilityTree
  orientation: DeviceOrientation
  /** Screen size the bounds were resolved against. */
  screen: { width: number; height: number }
  /** True when the node budget cut the tree short. */
  truncated: boolean
}

/**
 * Turn one dump into the agent-facing tree.
 *
 * Refs are assigned in traversal order, exactly as the iOS backend does, and the map
 * they resolve to is an index into that same traversal. There is no durable handle to
 * point at on this platform — `uiautomator dump` is a snapshot with no element table
 * behind it — so `press` by ref is not offered here and the index exists only to keep
 * the shape of the contract.
 */
export function uiautomatorToTree(
  output: string,
  options: UiautomatorTreeOptions = {},
): UiautomatorDump | null {
  const document = parseXml(stripDumpTrailer(output))
  if (!document) return null

  const rotation = Number.parseInt(document.attributes.rotation ?? '0', 10)
  const orientation = orientationForRotation(Number.isFinite(rotation) ? rotation : 0)

  // The root node's own bounds ARE the screen, but only on a dump that came out
  // whole. A caller that knows the size from the framebuffer should say so.
  const rootNode = document.children[0]
  const rootBounds = rootNode ? parseBounds(rootNode.attributes.bounds ?? '') : null
  const screen = options.screen
    ?? (rootBounds ? { width: rootBounds.right, height: rootBounds.bottom } : null)
  if (!screen || !(screen.width > 0) || !(screen.height > 0)) return null

  const maxNodes = Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES)
  const refs = new Map<string, number>()
  let count = 0
  let dropped = 0

  const convert = (element: XmlElement): DeviceUiNode | null => {
    if (count >= maxNodes) {
      dropped += 1
      return null
    }
    const ref = `@e${count}`
    refs.set(ref, count)
    count += 1

    const attributes = element.attributes
    const role = roleForClass(attributes.class ?? '', attributes.clickable === 'true')
    const node: DeviceUiNode = { ref, role }

    const described = attributes['content-desc']?.trim() ?? ''
    const text = attributes.text?.trim() ?? ''
    // A content description is the label whenever the app wrote one. Otherwise the
    // visible text is what a person would call this control, and putting it in `label`
    // is what makes a query written against iOS find the same button here. An editable
    // field is the exception: its text is what the USER typed, which is a value.
    if (EDITABLE.has(role)) {
      if (described) node.label = described
      else if (attributes.hint?.trim()) node.label = attributes.hint.trim()
      if (text) node.value = text
    } else {
      const label = described || text
      if (label) node.label = label
      // Kept as well when both exist and differ: "Play" described over a button whose
      // face reads "Resume" is two facts, and dropping either loses a way to find it.
      if (described && text && described !== text) node.value = text
    }

    // The full `com.app:id/login_button`, not just the tail. It is the most durable
    // handle a first-party app offers, and the package half is what keeps a system id
    // apart from an identically named one in the app under test.
    const identifier = attributes['resource-id']?.trim()
    if (identifier) node.identifier = identifier
    if (attributes.enabled === 'false') node.enabled = false
    if (attributes.focused === 'true') node.focused = true
    // Whether a toggle is on is the entire reason to read one, and `DeviceUiNode` has
    // nowhere else to put it. Never overwrites a value that means something else.
    if (attributes.checkable === 'true' && node.value === undefined) {
      node.value = attributes.checked === 'true' ? 'checked' : 'unchecked'
    }

    const bounds = parseBounds(attributes.bounds ?? '')
    if (bounds) {
      const round = (value: number) => Math.round(value * 1e4) / 1e4
      node.bounds = [
        round(bounds.left / screen.width),
        round(bounds.top / screen.height),
        round((bounds.right - bounds.left) / screen.width),
        round((bounds.bottom - bounds.top) / screen.height),
      ]
    }

    const children = element.children
      .map(convert)
      .filter((child): child is DeviceUiNode => child !== null)
    if (children.length) node.children = children
    return node
  }

  const root = rootNode ? convert(rootNode) : null
  if (!root) return null
  if (dropped) root.truncatedChildren = dropped

  return {
    tree: { root, refs, screenPoints: screen },
    orientation,
    screen,
    truncated: dropped > 0,
  }
}
