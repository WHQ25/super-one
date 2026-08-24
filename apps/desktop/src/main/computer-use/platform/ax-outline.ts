import type { UiNodeCapabilities, UiOutlineNode } from '../types'
import type { HelperAxNode } from './helper-protocol'

/** Map AXRole → short role used in outline (e.g. AXButton → button). */
export function mapAxRole(axRole: string): string {
  const raw = axRole.startsWith('AX') ? axRole.slice(2) : axRole
  if (!raw) return 'unknown'
  return raw.charAt(0).toLowerCase() + raw.slice(1)
}

/**
 * Roles whose AXValue is the text a person types. An allow-list, because the
 * substring test this replaced ("does the role contain text/field/area?") also
 * matched AXStaticText and AXWebArea — so every label and the page itself
 * advertised a typing target that does not exist.
 *
 * The list is not the whole story: Chromium exposes a `<div contenteditable>`
 * as a settable AXGroup, and an empty one reports no value at all, so nothing
 * about its role or content says "text goes here" except `settable`. That is
 * why `settable` still grants typing on any role. Offering a typing target that
 * turns out to be inert costs the model one wasted call; withholding one from a
 * real editor leaves the text unreachable.
 */
const EDITABLE_ROLES = new Set([
  'textField',
  'textArea',
  'comboBox',
  'searchField',
  'secureTextField',
])

function capabilitiesFromAx(node: HelperAxNode): UiNodeCapabilities {
  const actions = new Set((node.actions ?? []).map((a) => a.toLowerCase()))
  const role = mapAxRole(node.role)
  return {
    press: actions.has('axpress') || actions.has('press'),
    setText: !!node.settable,
    typeText: !!node.settable || EDITABLE_ROLES.has(role),
    scroll:
      actions.has('axscrollleftobymore')
      || actions.has('axscrollrightbymore')
      || actions.has('axscrollupbymore')
      || actions.has('axscrolldownbymore')
      || role.toLowerCase().includes('scroll'),
    focus: actions.has('axraise') || actions.has('raise') || !!node.focused,
  }
}

/**
 * Convert helper AX tree into UiOutlineNode forest with refs `@e{index}`.
 * Indices match the helper DFS walk used by `ax_action`.
 */
export function axTreeToOutline(root: HelperAxNode): UiOutlineNode {
  function walk(n: HelperAxNode): UiOutlineNode {
    const node: UiOutlineNode = {
      ref: `@e${n.index}`,
      role: mapAxRole(n.role),
      name: n.name,
      value: n.value,
      bounds: n.bounds
        ? {
            x: n.bounds.x,
            y: n.bounds.y,
            width: n.bounds.width,
            height: n.bounds.height,
          }
        : undefined,
      enabled: n.enabled,
      focused: n.focused,
      appFocused: n.appFocused,
      pictureOnly: false,
      capabilities: capabilitiesFromAx(n),
    }
    if (n.children?.length) {
      node.children = n.children.map(walk)
    }
    return node
  }
  return walk(root)
}

/** Parse `@e12` → 12. Returns undefined if not an element ref. */
export function parseElementIndex(ref: string): number | undefined {
  const m = /^@e(\d+)$/.exec(ref)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 1 ? n : undefined
}

/** Picture-only screen root used when AX is unavailable or mode=visual. */
export function pictureOnlyOutline(
  name: string,
  width: number,
  height: number,
): UiOutlineNode {
  return {
    ref: '@e1',
    role: 'screen',
    name,
    pictureOnly: true,
    bounds: { x: 0, y: 0, width, height },
    capabilities: {
      press: false,
      setText: false,
      typeText: false,
      scroll: false,
      focus: false,
    },
  }
}
