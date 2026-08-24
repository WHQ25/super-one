import type { UiNodeCapabilities, UiOutlineNode } from './types'

/**
 * Remove redundancy from an outline before it is folded to the node budget.
 *
 * Chromium's accessibility tree is shaped for screen readers walking it node by
 * node, not for a model reading a table. It spends three rows on one sidebar
 * link — an unnamed `link`, an unnamed `group` forwarding the same press, and a
 * `staticText` holding the label — and stacks unnamed layout groups five deep
 * above every control. None of that is addressable, and it crowds out real
 * content inside the fold budget.
 *
 * This is a policy pass, not a truncation: the complete outline stays in the
 * state store, so computer_query still resolves anything dropped here. Refs are
 * helper DFS indices carried on the node, so dropping rows never renumbers the
 * survivors and `ax_action` keeps resolving the same elements.
 */

/** Roles Chromium and AppKit emit purely as layout scaffolding. */
const WRAPPER_ROLES = new Set(['group', 'unknown'])

/** Roles that exist only to paint something. */
const DECORATIVE_ROLES = new Set(['image'])

const NO_CAPS: UiNodeCapabilities = {
  press: false,
  setText: false,
  typeText: false,
  scroll: false,
  focus: false,
}

function caps(node: UiOutlineNode): UiNodeCapabilities {
  return node.capabilities ?? NO_CAPS
}

function label(node: UiOutlineNode): string {
  return (node.name || node.value || '').trim()
}

function isLeaf(node: UiOutlineNode): boolean {
  return !node.children?.length
}

/**
 * Anything a person could aim at, ignoring a press that merely forwards.
 *
 * `focus` counts: it is set for the node that currently holds the caret, and
 * folding away where focus sits is exactly the fact the model needs most.
 */
function hasRealCapability(node: UiOutlineNode): boolean {
  const c = caps(node)
  return !!(c.setText || c.typeText || c.scroll || c.focus)
}

/** A blank container: nothing to read, nothing to do, no reason to keep a row. */
function isEmptyWrapper(node: UiOutlineNode): boolean {
  if (!WRAPPER_ROLES.has(node.role)) return false
  if (label(node)) return false
  const c = caps(node)
  return !(c.press || c.setText || c.typeText || c.scroll || c.focus)
}

function isDecorative(node: UiOutlineNode): boolean {
  if (!DECORATIVE_ROLES.has(node.role)) return false
  if (label(node) || !isLeaf(node)) return false
  const c = caps(node)
  return !(c.press || c.setText || c.typeText || c.scroll || c.focus)
}

/**
 * A wrapper that only re-offers the press its parent already offers.
 *
 * Both conditions matter. Sole child: with siblings around, removing the group
 * would lose the fact that they belong together. Actionable parent: without a
 * press above it, this wrapper is the only thing at that rect the model can
 * click, so dropping it would delete a control rather than a duplicate.
 */
function isForwardingWrapper(
  node: UiOutlineNode,
  siblingCount: number,
  parent: UiOutlineNode,
): boolean {
  if (siblingCount !== 1) return false
  if (!caps(parent).press) return false
  if (!WRAPPER_ROLES.has(node.role)) return false
  if (label(node)) return false
  const c = caps(node)
  return !!c.press && !c.setText && !c.typeText && !c.scroll
}

/**
 * The one piece of text a subtree contributes, or undefined when it contributes
 * none, several, or something the model would lose by having it folded away.
 *
 * An unnamed node that only offers `press` is treated as a forwarding wrapper
 * rather than a control — but only when its role is a wrapper role. An unnamed
 * `button` is an icon button, reachable by nothing but its own rect; folding one
 * away hands the model a parent that covers the whole sidebar instead.
 *
 * The subtree must also be a chain rather than a fork. Collapsing a fork
 * silently deletes whichever branch did not supply the label, and an unnamed
 * branch has no other row to be found by.
 *
 * Collapsing a chain is a deliberate trade, not a proof. Topology cannot
 * establish that two presses on one chain are the same action, and measurement
 * says geometry cannot either: in a real Chromium window, 16 of 27 unnamed
 * press chains changed bounds partway down, so requiring equal rects would
 * block most genuine forwarding. We treat a single unnamed wrapper press chain
 * as forwarding and accept the residual risk — see the limitation test in
 * __tests__/outline-compact.test.ts.
 */
function subtreeHasPress(node: UiOutlineNode): boolean {
  return !!caps(node).press || (node.children ?? []).some(subtreeHasPress)
}

function soleLabel(nodes: UiOutlineNode[]): string | undefined {
  let found: string | undefined
  const visit = (node: UiOutlineNode): boolean => {
    if (hasRealCapability(node)) return false
    if (caps(node).press && !WRAPPER_ROLES.has(node.role)) return false
    const text = label(node)
    if (text) {
      // A named control is a target in its own right; never bury one.
      if (caps(node).press) return false
      if (found !== undefined && found !== text) return false
      found = text
    }
    return descend(node.children ?? [])
  }
  const descend = (kids: UiOutlineNode[]): boolean => {
    if (kids.filter(subtreeHasPress).length > 1) return false
    return kids.every(visit)
  }
  return descend(nodes) ? found : undefined
}

/** An actionable node whose own label is only reachable through its children. */
function promotableLabel(node: UiOutlineNode): string | undefined {
  if (label(node)) return undefined
  if (!caps(node).press) return undefined
  if (isLeaf(node)) return undefined
  return soleLabel(node.children ?? [])
}

/** Rewrite one child list until no rule applies to it any more. */
function compactChildren(parent: UiOutlineNode, children: UiOutlineNode[]): UiOutlineNode[] {
  let current = children
  for (;;) {
    const next: UiOutlineNode[] = []
    for (const child of current) {
      if (isDecorative(child)) continue
      // A label that only repeats what the parent row already says.
      if (child.role === 'staticText' && isLeaf(child) && !hasRealCapability(child)) {
        const text = label(child)
        if (text && (text === (parent.name ?? '').trim() || text === (parent.value ?? '').trim())) {
          continue
        }
      }
      if (isEmptyWrapper(child) || isForwardingWrapper(child, current.length, parent)) {
        next.push(...(child.children ?? []))
        continue
      }
      next.push(child)
    }
    if (next.length === current.length && next.every((n, i) => n === current[i])) return next
    current = next
  }
}

export function compactOutline(root: UiOutlineNode): UiOutlineNode {
  const rewrite = (node: UiOutlineNode): UiOutlineNode => {
    const copy: UiOutlineNode = { ...node }
    const children = compactChildren(copy, node.children ?? [])
    if (!children.length) {
      delete copy.children
      return copy
    }
    const promoted = children.map((child) => {
      const text = promotableLabel(child)
      if (text === undefined) return rewrite(child)
      const flat: UiOutlineNode = { ...child, name: text }
      delete flat.children
      return flat
    })
    copy.children = promoted
    return copy
  }
  // The root is the caller's chosen observation scope; never dissolve it.
  return rewrite(root)
}

function boundsKey(node: UiOutlineNode): string | undefined {
  const b = node.bounds
  if (!b) return undefined
  return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
}

function holdsAppFocus(node: UiOutlineNode): boolean {
  if (node.appFocused) return true
  return (node.children ?? []).some(holdsAppFocus)
}

/**
 * Drop web areas that are stacked behind another one.
 *
 * Electron stacks a WebContentsView per page at identical window bounds and
 * keeps every one of them in the accessibility tree, so a two-page app hands the
 * model two complete UIs and no way to tell which is on screen. Acting on the
 * hidden one always fails, and it is not a token problem — it is the model
 * clicking at coordinates where something else is drawn.
 *
 * `focused` cannot decide it: each web view reports focus inside its own
 * subtree, so both claim it. The application's AXFocusedUIElement is singular,
 * which is why the helper flags it separately.
 *
 * Conservative by construction: a stack is only thinned when exactly one member
 * holds that focus. If focus sits in native chrome, or the window has not been
 * clicked into yet, every page is kept — guessing would risk deleting the page
 * the person is actually looking at.
 */
export function dropOccludedWebAreas(root: UiOutlineNode): UiOutlineNode {
  const stacks = new Map<string, UiOutlineNode[]>()
  const webAncestors = new Map<UiOutlineNode, UiOutlineNode[]>()
  const scan = (node: UiOutlineNode, ancestors: UiOutlineNode[]): void => {
    let inherited = ancestors
    if (node.role === 'webArea') {
      const key = boundsKey(node)
      if (key) {
        const stack = stacks.get(key)
        if (stack) stack.push(node)
        else stacks.set(key, [node])
        webAncestors.set(node, ancestors)
      }
      inherited = [...ancestors, node]
    }
    for (const child of node.children ?? []) scan(child, inherited)
  }
  scan(root, [])

  const occluded = new Set<UiOutlineNode>()
  for (const stack of stacks.values()) {
    if (stack.length < 2) continue
    // A full-bleed iframe reports its host's bounds while living inside it.
    // Nesting means "part of", never "instead of", so this is not a stack at
    // all — and the host would win the focus test whenever the caret sits in
    // the surrounding page, deleting a frame that is plainly on screen.
    const nested = stack.some((area) =>
      (webAncestors.get(area) ?? []).some((ancestor) => stack.includes(ancestor)),
    )
    if (nested) continue
    const focused = stack.filter(holdsAppFocus)
    if (focused.length !== 1) continue
    for (const area of stack) if (area !== focused[0]) occluded.add(area)
  }
  if (occluded.size === 0) return root

  const rewrite = (node: UiOutlineNode): UiOutlineNode => {
    const copy: UiOutlineNode = { ...node }
    const kids = (node.children ?? []).filter((c) => !occluded.has(c)).map(rewrite)
    copy.children = kids
    return copy
  }
  return rewrite(root)
}
