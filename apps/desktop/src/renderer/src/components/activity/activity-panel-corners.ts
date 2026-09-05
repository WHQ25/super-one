import type { ActivityPanelBounds } from '@/stores/activity-panel'

interface SlotRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Sub-pixel layout and the `Math.round` in useSlotBounds both move an edge by
 * less than a pixel, which is never a real gap.
 */
const EDGE_TOLERANCE = 1

export interface PanelCornerOwnership {
  bottomLeft: boolean
  bottomRight: boolean
}

const NO_CORNERS: PanelCornerOwnership = { bottomLeft: false, bottomRight: false }

/**
 * Which of the activity panel's bottom corners this slot actually sits on.
 *
 * The panel's outer corners are rounded to match the main card, and React-rendered
 * panel content inherits that for free by being clipped inside it. A webview does
 * not: it is composited by a host layer outside the panel, so it has to round its
 * own corner or it squares off the card. That is only true for the ONE group in the
 * corner, though — every other group's bottom edge runs into a sash, where a radius
 * reads as a notch.
 */
export function panelCornersForSlot(
  slot: SlotRect | null | undefined,
  panel: ActivityPanelBounds | null,
): PanelCornerOwnership {
  if (!slot || !panel) return NO_CORNERS
  if (Math.abs(slot.top + slot.height - (panel.top + panel.height)) > EDGE_TOLERANCE) return NO_CORNERS
  return {
    bottomLeft: Math.abs(slot.left - panel.left) <= EDGE_TOLERANCE,
    bottomRight: Math.abs(slot.left + slot.width - (panel.left + panel.width)) <= EDGE_TOLERANCE,
  }
}
