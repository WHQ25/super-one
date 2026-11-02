import { Box3, Matrix4, Vector3 } from 'three'

export interface FramePlacement {
  /** Box center. A camera looking along −Z at this point keeps the body in the middle. */
  target: Vector3
  /** Distance from `target` along +Z that fits the centered size. */
  distance: number
}

/**
 * Where a camera that looks along −Z should stand to frame `box`.
 *
 * The aim point follows the box, so a body that has slid off the origin is recentered
 * by moving the camera, not by backing up. The distance fits that centered size, and
 * changes only when the centered body no longer fits.
 */
export function frameBounds(box: Box3, fovDegrees: number, aspect: number, margin: number): FramePlacement {
  const size = box.getSize(new Vector3())
  const vertical = Math.tan((fovDegrees * Math.PI) / 360)
  const horizontal = vertical * Math.max(aspect, 1e-6)
  const span = Math.max(size.y / 2 / vertical, size.x / 2 / horizontal)
  return {
    target: box.getCenter(new Vector3()),
    distance: Math.max(span * margin + size.z / 2, 1e-3),
  }
}

/**
 * The rigid move, in the view's frame, that shows `seen` and ends at `arrived`.
 *
 * `seen` and `arrived` are the body's world matrices. `viewWorld` is the view group's
 * world matrix once the body is in the arrived pose and this correction is still identity.
 * Quaternion slerp of the result toward identity is the short arc.
 */
export function viewCorrection(seen: Matrix4, arrived: Matrix4, viewWorld: Matrix4): Matrix4 {
  return new Matrix4().copy(viewWorld).invert().multiply(seen).multiply(new Matrix4().copy(arrived).invert()).multiply(viewWorld)
}
