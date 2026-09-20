import type { CoordinateSpace, UiAction, UiOutlineNode, UiRootIdentity } from '../types'
import { findNode } from '../outline'
import { parseElementIndex } from './ax-outline'
import type { PlatformActStepResult } from './types'
import type { HelperAxActionResult } from './helper-protocol'
import type { MacosHelperClient } from './macos-helper-client'

/**
 * Scroll by writing the scroll bar's value, the reliable way to scroll an app
 * in the background: a scroller's AXValue is settable, takes effect at once
 * and pages exactly, where a posted wheel carries inertia. The value is a
 * fraction of the scrollable range, so a pixel delta maps through content
 * minus viewport. `room: false` is a bar that exists but cannot move further
 * in that direction — the end of the list, not a reason to post a wheel.
 */
export function scrollBarSetting(area: UiOutlineNode | undefined, dx: number, dy: number): { ref: string; value: number; room: boolean } | undefined {
  if (!area?.bounds) return undefined
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const children = area.children ?? []
  const bar = children.find((c) => c.role === 'scrollBar' && !!c.bounds && (c.bounds.height > c.bounds.width) === vertical)
  const content = children.filter((c) => c.role !== 'scrollBar' && c.bounds).sort((a, b) => extent(b, vertical) - extent(a, vertical))[0]
  if (!bar || !content) return undefined
  const range = extent(content, vertical) - extent(area, vertical)
  if (range <= 0) return undefined
  const current = Number(bar.value)
  const next = Math.min(1, Math.max(0, (Number.isFinite(current) ? current : 0) + (vertical ? dy : dx) / range))
  if (Math.abs(next - current) < 1e-6) return { ref: bar.ref, value: current, room: false }
  return { ref: bar.ref, value: Math.round(next * 1e4) / 1e4, room: true }
}

function extent(node: UiOutlineNode, vertical: boolean): number {
  return vertical ? node.bounds?.height ?? 0 : node.bounds?.width ?? 0
}

export class MacosSemanticExecutor {
  constructor(
    private readonly client: MacosHelperClient,
    private readonly showActionCursor: (root: UiRootIdentity, options: { ref: string; outline?: UiOutlineNode; pulse: boolean; coordinateSpace?: CoordinateSpace }) => Promise<void>,
    private readonly coordinatePayload: (space?: CoordinateSpace) => Record<string, unknown>,
  ) {}
  /**
   * AX only; never posts a CGEvent. The adapter sends an action here when its
   * ref supports the native action, and a failure stays a failure — it does
   * not fall through to posted input.
   */
  async act(
    action: UiAction,
    target: {
      bundleId: string
      pid: number
      root: UiRootIdentity
      outline?: UiOutlineNode
      coordinateSpace?: CoordinateSpace
    },
  ): Promise<PlatformActStepResult> {
    switch (action.type) {
      case 'select':
      case 'open':
        return this.axActionStep(target, action.ref, action.type)
      case 'press': {
        return this.axActionStep(target, action.ref, 'press')
      }
      case 'setText': {
        return this.axActionStep(target, action.ref, 'set_value', action.text)
      }
      case 'click': {
        // A click on a pressable ref is its native press.
        if (!action.ref) {
          return { applied: false, description: 'click: an AX press needs a ref' }
        }
        return this.axActionStep(target, action.ref, 'press')
      }
      case 'scroll': {
        if (!action.ref) {
          return { applied: false, description: 'scroll: a scroll bar write needs a ref' }
        }
        const dy = action.dy ?? 0
        const dx = action.dx ?? 0
        if (dx === 0 && dy === 0) {
          return { applied: false, description: 'scroll: requires dx and/or dy' }
        }
        const area = target.outline ? findNode(target.outline, action.ref) : undefined
        const bar = scrollBarSetting(area, dx, dy)
        if (!bar) {
          return { applied: false, description: 'scroll: the target has no scroll bar' }
        }
        if (!bar.room) {
          return { applied: false, description: 'scroll: the scroll bar has no room to move in that direction' }
        }
        return this.axActionStep(target, bar.ref, 'set_value', String(bar.value))
      }
      case 'typeText':
      case 'keypress':
      case 'drag':
      case 'moveMouse':
        return { applied: false, description: `${action.type}: not an AX action` }
      default: {
        const _e: never = action
        return { applied: false, description: `unknown action ${JSON.stringify(_e)}` }
      }
    }
  }

  private async axActionStep(
    target: {
      pid: number
      root: UiRootIdentity
      outline?: UiOutlineNode
      coordinateSpace?: CoordinateSpace
    },
    ref: string,
    action: string,
    value?: string,
  ): Promise<PlatformActStepResult> {
    const idx = parseElementIndex(ref)
    if (idx == null) {
      return { applied: false, description: `${action}: invalid ref ${ref}` }
    }
    let node: UiOutlineNode | undefined
    if (target.outline) {
      node = findNode(target.outline, ref)
      if (!node) {
        return { applied: false, description: `${action}: ref ${ref} not in outline` }
      }
      if (node.pictureOnly) {
        return {
          applied: false,
          description: `${action}: ${ref} is picture-only (observe semantic/fused for AX)`,
        }
      }
    }
    try {
      // AX press/setText never went through click/drag — paint software cursor at
      // the element (or window) so agent runs are observable like OCU.
      await this.showActionCursor(target.root, {
        ref,
        outline: target.outline,
        pulse: true,
        coordinateSpace: target.coordinateSpace,
      })
      const res = await this.client.call<HelperAxActionResult>('ax_action', {
        pid: target.pid,
        targetPid: target.pid,
        index: node?.nativeTarget?.index ?? idx,
        ...(node?.nativeTarget ? { axSource: node.nativeTarget.scope } : {}),
        action,
        ...(value != null ? { value } : {}),
        windowTitle: target.root.title,
        ...(typeof target.root.windowId === 'number'
          ? { windowId: target.root.windowId }
          : {}),
        ...(target.root.axRootId ? { axRootId: target.root.axRootId } : {}),
        ...axTargetHintFields(node, target.coordinateSpace),
        ...this.coordinatePayload(target.coordinateSpace),
      })
      const before = { value: res.beforeValue, name: res.beforeName }
      const after = { value: res.afterValue, name: res.afterName }
      let unknown = true
      let confirmedNoEffect = false
      if (action === 'select' && res.afterSelected === true) {
        unknown = false
      } else if (action === 'set_value' && value != null) {
        if (res.afterValue === value || (res.afterValue ?? '').includes(value)) {
          unknown = false
        } else if (res.afterValue === res.beforeValue) {
          confirmedNoEffect = true
          unknown = false
        }
      } else if (action === 'press') {
        // Press has no reliable readback without a richer diff — leave unknown
        // unless the node changed. Value covers toggle-shaped controls (a radio
        // flipping 0 → 1); name covers controls that relabel instead
        // (Play → Pause). Both must be read, because a control that has no
        // value now correctly reports undefined rather than echoing its title.
        const changed = (a: string | undefined, b: string | undefined) =>
          a !== undefined && b !== undefined && a !== b
        if (changed(res.afterValue, res.beforeValue) || changed(res.afterName, res.beforeName)) {
          unknown = false
        }
      }
      return {
        applied: true,
        unknown,
        confirmedNoEffect,
        description: res.recovered
          ? `ax ${action} ${ref} (recovered index ${idx} -> ${res.index})`
          : `ax ${action} ${ref} (index ${idx})`,
        before,
        after,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: string }).code
      return {
        applied: false,
        description: `ax ${action} ${ref}: ${code ?? 'error'}: ${message}`,
      }
    }
  }
}

export function axTargetHintFields(
  node: UiOutlineNode | undefined,
  coordinateSpace: CoordinateSpace | undefined,
): Record<string, unknown> {
  if (!node) return {}
  return {
    expectedRole: node.role,
    ...(node.name ? { expectedName: node.name } : {}),
    ...(node.value != null ? { expectedValue: node.value } : {}),
    ...(node.bounds
      ? {
          expectedBounds: [
            node.bounds.x,
            node.bounds.y,
            node.bounds.width,
            node.bounds.height,
          ],
        }
      : {}),
    ...(coordinateSpace
      ? {
          expectedCoordinateWidth: coordinateSpace.width,
          expectedCoordinateHeight: coordinateSpace.height,
          ...(coordinateSpace.capturedBounds
            ? {
                expectedCoordinateX: coordinateSpace.capturedBounds.x,
                expectedCoordinateY: coordinateSpace.capturedBounds.y,
                expectedCoordinateSourceWidth: coordinateSpace.capturedBounds.width,
                expectedCoordinateSourceHeight: coordinateSpace.capturedBounds.height,
              }
            : {}),
        }
      : {}),
  }
}
