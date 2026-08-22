/**
 * Reading and comparing UI trees, independently of which device produced one.
 *
 * Everything here works on `DeviceUiNode` and nothing else, so it is shared by every
 * backend rather than reimplemented per platform. The platform-specific half — how a
 * guest's own coordinate space maps onto the framebuffer, how one platform's raw dump
 * is converted — lives beside that backend; see `ios-simulator/a11y-tree.ts`.
 */

import {
  isDeviceLandscape,
  type DeviceOrientation,
  type DeviceUiBounds,
  type DeviceUiNode,
} from '@superone/shared/device-agent'

export interface NormalizedAccessibilityTree {
  root: DeviceUiNode
  /**
   * `@eN` -> the backend's own handle for the same element.
   *
   * What the number means is the backend's business — a helper uid on iOS — and no
   * layer above this one may read it. Absent from the map means the ref addresses no
   * real element, which is how an OCR line is represented.
   */
  refs: Map<string, number>
  /** The guest's own screen size, in whatever units its bounds were reported in. */
  screenPoints: { width: number; height: number }
  /**
   * Set when the tree was recovered from pixels because the app exposed no usable
   * accessibility tree. Carried on the tree rather than inferred from an empty
   * `refs` map, so a backend can refuse `press` with a reason instead of reporting
   * every ref as unknown.
   */
  source?: 'ocr'
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

/**
 * Whether this tree describes anything an agent could act on.
 *
 * The check that decides between reading the app's own semantics and falling back to
 * the pixels. A WebView, a game canvas, or a framework that only builds its
 * accessibility tree when a screen reader is running all return a structurally valid
 * tree with nothing named in it -- which is indistinguishable from a blank screen
 * unless someone asks this question.
 *
 * Deliberately strict: one named node is enough to keep the real tree, because OCR
 * costs an order of magnitude more and gives back strictly less (no identifiers, no
 * roles, no state, and nothing at all for icon-only controls).
 */
export function hasUsableSemantics(root: DeviceUiNode): boolean {
  const named = (node: DeviceUiNode): boolean =>
    Boolean(node.label || node.identifier || node.value)
      || (node.children ?? []).some(named)
  return named(root)
}

/** Rows the screen is sliced into when measuring where semantics run out. */
const GAP_ROWS = 64

/**
 * How much of the screen height must be semantically blank before pixels are worth
 * reading. A phone's chrome leaves small gaps everywhere -- between icon rows, above
 * a tab bar -- and paying for OCR on those would tax every snapshot. A WebView or a
 * game canvas leaves one band that is most of the screen.
 */
const SEMANTIC_GAP_FRACTION = 0.35

/**
 * A named node bigger than this is a container, not content, no matter what the tree
 * says. Safari labels its application root; a WebView can carry an accessibilityLabel
 * over the whole page. Counting either as "this area is described" is exactly how a
 * blank content region hides.
 */
const CONTAINER_AREA_LIMIT = 0.9

/** An OCR line this covered by a named element is that element, read twice. */
const DUPLICATE_OVERLAP = 0.6

function isNamed(node: DeviceUiNode): boolean {
  return Boolean(node.label || node.identifier || node.value)
}

/**
 * The boxes that actually describe content, as opposed to the boxes around it.
 *
 * Only the deepest named node in a branch counts. An ancestor that carries a label
 * *and* named descendants is a grouping — a toolbar, an app root — and its frame
 * spans everything below it, so counting it would paint the whole screen as
 * described. A named node whose children are unnamed decoration (a cell holding an
 * image) is still the deepest one there, and does count.
 */
function namedContentBounds(root: DeviceUiNode): DeviceUiBounds[] {
  const out: DeviceUiBounds[] = []
  const walk = (node: DeviceUiNode): boolean => {
    let describedBelow = false
    for (const child of node.children ?? []) {
      if (walk(child)) describedBelow = true
    }
    if (!isNamed(node)) return describedBelow
    if (!describedBelow && node.bounds && node.bounds[2] * node.bounds[3] < CONTAINER_AREA_LIMIT) {
      out.push(node.bounds)
    }
    return true
  }
  walk(root)
  return out
}

/**
 * The tallest band of screen that no named element describes, as a fraction of height.
 *
 * `hasUsableSemantics` asks a whole-screen question, but the answer is regional: a
 * Safari window with a web page in it has a fully described top and bottom and a
 * completely dark middle. One named node anywhere is enough to keep the tree, so the
 * page itself reads as a blank screen to anything that only asks the global question.
 *
 * Bands rather than rectangles because that is the shape phone chrome actually takes —
 * a status bar and a toolbar with everything else between them.
 */
export function largestSemanticGap(
  root: DeviceUiNode,
  orientation: DeviceOrientation = 'portrait',
): number {
  const occupied = new Array<boolean>(GAP_ROWS).fill(false)
  // Bounds reach here in FRAMEBUFFER space, which on some platforms does not turn
  // with the device. A landscape guest's status bar and toolbar are side strips
  // there, each spanning the full framebuffer height — band along Y and every row
  // reads as occupied, so the gap is always zero and the whole hybrid path is dead on
  // its side. The bands have to follow the GUEST's vertical axis.
  const sideways = isDeviceLandscape(orientation)
  for (const bounds of namedContentBounds(root)) {
    const start = sideways ? bounds[0] : bounds[1]
    const extent = sideways ? bounds[2] : bounds[3]
    const from = Math.max(0, Math.floor(start * GAP_ROWS))
    const to = Math.min(GAP_ROWS - 1, Math.ceil((start + extent) * GAP_ROWS) - 1)
    for (let row = from; row <= to; row += 1) occupied[row] = true
  }
  let longest = 0
  let run = 0
  for (const taken of occupied) {
    run = taken ? 0 : run + 1
    if (run > longest) longest = run
  }
  return longest / GAP_ROWS
}

/** Whether this screen is described well enough that reading its pixels adds nothing. */
export function hasSemanticGap(
  root: DeviceUiNode,
  orientation: DeviceOrientation = 'portrait',
): boolean {
  return largestSemanticGap(root, orientation) >= SEMANTIC_GAP_FRACTION
}

/** How much of `box` lies inside `other`, as a fraction of `box`. */
function overlapFraction(box: DeviceUiBounds, other: DeviceUiBounds): number {
  const width = Math.min(box[0] + box[2], other[0] + other[2]) - Math.max(box[0], other[0])
  const height = Math.min(box[1] + box[3], other[1] + other[3]) - Math.max(box[1], other[1])
  if (!(width > 0) || !(height > 0)) return 0
  const area = box[2] * box[3]
  return area > 0 ? (width * height) / area : 0
}

/**
 * Graft text read from pixels into the app's own tree, for the parts it did not describe.
 *
 * The alternative — replacing the whole tree with OCR the moment any region is blank —
 * throws away everything that made the native tree worth having: identifiers, roles,
 * `press`, and every icon-only control, none of which survive a round trip through
 * pixels. Safari's back button would stop existing so that the web page could start.
 *
 * So the two are merged instead. Recognized lines that land on top of something the
 * app already named are dropped as duplicates; the rest become extra children of the
 * root, carrying `source: 'ocr'` so the layers above can refuse `press` on exactly
 * those and on nothing else.
 *
 * Refs continue past the native tree's numbering and are deliberately absent from
 * `refs`: they address no real element, and that is the honest representation.
 */
export function mergeRecognizedText(
  tree: NormalizedAccessibilityTree,
  recognized: NormalizedAccessibilityTree,
): { tree: NormalizedAccessibilityTree; added: number } {
  const described = namedContentBounds(tree.root)
  const lines = (recognized.root.children ?? []).filter((line) => {
    if (!line.bounds) return false
    return !described.some((box) => overlapFraction(line.bounds!, box) >= DUPLICATE_OVERLAP)
  })
  if (lines.length === 0) return { tree, added: 0 }

  let next = tree.refs.size
  const grafted = lines.map((line) => ({ ...line, ref: `@e${next++}` }))
  return {
    tree: {
      ...tree,
      root: { ...tree.root, children: [...(tree.root.children ?? []), ...grafted] },
    },
    added: grafted.length,
  }
}

/** Whether any part of this tree was read from pixels rather than described by the app. */
export function containsRecognizedText(root: DeviceUiNode): boolean {
  if (root.source === 'ocr') return true
  return (root.children ?? []).some(containsRecognizedText)
}

/**
 * The same tree with everything read from pixels taken back out.
 *
 * What makes a MERGED tree comparable between two captures. OCR re-segments on its
 * own — "Sign In" comes back as one line or as two — so a digest taken over the whole
 * grafted tree reports a change on a screen nobody touched, and `device_act` then
 * calls a no-op action `worked`. The described half does not drift, so it is the half
 * worth hashing.
 *
 * Null when nothing described is left, which is the pure-OCR screen: there the frame
 * hash is the only honest signal.
 */
export function withoutRecognizedText(root: DeviceUiNode): DeviceUiNode | null {
  if (root.source === 'ocr') return null
  const children = (root.children ?? [])
    .map(withoutRecognizedText)
    .filter((child): child is DeviceUiNode => child !== null)
  return { ...root, ...(root.children ? { children } : {}) }
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
