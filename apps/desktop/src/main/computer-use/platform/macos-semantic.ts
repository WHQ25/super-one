import type { CoordinateSpace, UiAction, UiOutlineNode, UiRootIdentity } from '../types'
import { findNode } from '../outline'
import { parseElementIndex } from './ax-outline'
import type { PlatformActStepResult } from './types'
import type { HelperAxActionResult } from './helper-protocol'
import type { MacosHelperClient } from './macos-helper-client'

/**
 * Scroll by writing the scroll bar's value, the one way to scroll an app in the
 * background: wheel events posted to a pid are dropped by an inactive app
 * (Finder's list never moved through twelve of them), while a scroller's
 * AXValue is settable and takes effect at once. The value is a fraction of the
 * scrollable range, so a pixel delta maps through content minus viewport.
 */
export function scrollBarSetting(area: UiOutlineNode | undefined, dx: number, dy: number): { ref: string; value: number } | undefined {
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
  if (Math.abs(next - current) < 1e-6) return undefined
  return { ref: bar.ref, value: Math.round(next * 1e4) / 1e4 }
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
   * delivery=semantic — AX only; never post CGEvent / HID.
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
        // Semantic click = AXPress on ref; coordinates are not semantic.
        if (!action.ref) {
          return {
            applied: false,
            description: 'click under delivery=semantic requires ref (use app-directed for x,y)',
          }
        }
        return this.axActionStep(target, action.ref, 'press')
      }
      case 'typeText': {
        if (!action.ref) {
          return {
            applied: false,
            description:
              'typeText under delivery=semantic requires ref with settable AXValue (use app-directed for keyboard typing)',
          }
        }
        return this.axActionStep(target, action.ref, 'set_value', action.text)
      }
      case 'scroll': {
        // Prefer AX page scroll actions when available; fail closed otherwise.
        if (!action.ref) {
          return {
            applied: false,
            description: 'scroll under delivery=semantic requires ref (use app-directed for wheel at x,y)',
          }
        }
        const dy = action.dy ?? 0
        const dx = action.dx ?? 0
        if (dx === 0 && dy === 0) {
          return { applied: false, description: 'scroll: requires dx and/or dy' }
        }
        const area = target.outline ? findNode(target.outline, action.ref) : undefined
        const bar = scrollBarSetting(area, dx, dy)
        if (!bar) {
          return {
            applied: false,
            description: 'scroll under delivery=semantic: the target has no scroll bar with room to move in that direction; use delivery=app-directed for a wheel at x,y',
          }
        }
        return this.axActionStep(target, bar.ref, 'set_value', String(bar.value))
      }
      case 'keypress':
      case 'drag':
      case 'moveMouse':
        return {
          applied: false,
          description: `${action.type}: not available under delivery=semantic (AX-only)`,
        }
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
