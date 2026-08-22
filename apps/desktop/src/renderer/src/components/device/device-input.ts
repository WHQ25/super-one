export interface FrameBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface NormalizedFramePoint {
  xRatio: number
  yRatio: number
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** CSS rotation, reduced to whole clockwise quarter turns. */
function quarterTurns(rotationDegrees: number): 0 | 1 | 2 | 3 {
  return (((Math.round(rotationDegrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3
}

/**
 * Undoes a clockwise quarter-turn on a vector expressed in screen space, giving the
 * same vector in the rotated element's own space.
 */
function unrotate(x: number, y: number, turns: 0 | 1 | 2 | 3): [number, number] {
  switch (turns) {
    case 1: return [y, -x]
    case 2: return [-x, -y]
    case 3: return [-y, x]
    default: return [x, y]
  }
}

/**
 * Maps a host pointer onto the framebuffer.
 *
 * The device shell is rotated with a CSS transform about its own centre, so
 * `getBoundingClientRect` reports the axis-aligned box around it — for a quarter
 * turn that box has the element's width and height swapped. Both facts are undone
 * here so touches keep landing where the user pointed. The framebuffer itself never
 * rotates: the guest draws its rotated UI into the same portrait surface, so these
 * ratios stay in the panel's own coordinates and the helper needs no adjustment.
 */
export function normalizeFramePoint(
  bounds: FrameBounds,
  clientX: number,
  clientY: number,
  rotationDegrees = 0,
): NormalizedFramePoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { xRatio: 0, yRatio: 0 }
  const turns = quarterTurns(rotationDegrees)
  if (turns === 0) {
    return {
      xRatio: clampRatio((clientX - bounds.left) / bounds.width),
      yRatio: clampRatio((clientY - bounds.top) / bounds.height),
    }
  }
  const width = turns === 2 ? bounds.width : bounds.height
  const height = turns === 2 ? bounds.height : bounds.width
  const [localX, localY] = unrotate(
    clientX - (bounds.left + bounds.width / 2),
    clientY - (bounds.top + bounds.height / 2),
    turns,
  )
  return {
    xRatio: clampRatio(localX / width + 0.5),
    yRatio: clampRatio(localY / height + 0.5),
  }
}

/**
 * A scroll or pan delta, turned from screen space into the rotated device's space so
 * a swipe still pushes the content the way the user pushed it.
 */
export function rotateFrameDelta(
  deltaX: number,
  deltaY: number,
  rotationDegrees = 0,
): { deltaX: number; deltaY: number } {
  const [x, y] = unrotate(deltaX, deltaY, quarterTurns(rotationDegrees))
  return { deltaX: x, deltaY: y }
}

/** The device's own width and height, recovered from the rotated bounding box. */
export function unrotateFrameSize(
  bounds: FrameBounds,
  rotationDegrees = 0,
): { width: number; height: number } {
  return quarterTurns(rotationDegrees) % 2 === 0
    ? { width: bounds.width, height: bounds.height }
    : { width: bounds.height, height: bounds.width }
}
