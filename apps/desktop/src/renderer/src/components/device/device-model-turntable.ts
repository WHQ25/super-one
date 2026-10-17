import { Euler, type Object3D } from 'three'

/** Radians turned per pixel dragged. */
const TURN_PER_PIXEL = Math.PI / 360
const ZOOM_PER_WHEEL_PIXEL = 0.0015
const ZOOM_RANGE = { min: 0.4, max: 3 }

export interface DeviceModelTurntable {
  /** Camera distance as a multiple of the fitted one. */
  zoom: () => number
  reset: () => void
  dispose: () => void
}

/**
 * Turns `target` the way a device is turned on a turntable rather than tumbled: a
 * sideways drag spins it about its own vertical axis, an up-and-down drag tips it
 * over, with no stop at the top, and neither ever rolls it. A roll only comes from
 * a sideways drag with Shift held. A trackball composes drags into a roll the user
 * never asked for, and the device ends up leaning.
 *
 * `canStart` lets a press go to the glass instead.
 */
export function attachDeviceModelTurntable(
  element: HTMLElement,
  target: Object3D,
  options: { canStart: (event: PointerEvent) => boolean; onChange: () => void },
): DeviceModelTurntable {
  let yaw = 0
  let pitch = 0
  let roll = 0
  let zoom = 1
  let drag: { pointerId: number; x: number; y: number } | null = null

  const apply = () => {
    // Spin about the body's own axis, tip about the view's horizontal, roll about the
    // line of sight: each drag direction stays one rotation whatever came before.
    target.quaternion.setFromEuler(new Euler(pitch, yaw, roll, 'ZXY'))
    target.updateMatrixWorld(true)
    options.onChange()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !options.canStart(event)) return
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    element.setPointerCapture(event.pointerId)
    element.style.cursor = 'grabbing'
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.x = event.clientX
    drag.y = event.clientY
    if (event.shiftKey) {
      roll -= dx * TURN_PER_PIXEL
    } else {
      // Tipped past the top the body is upside down, and a sideways drag would spin it
      // against the hand; follow the hand instead.
      yaw += dx * TURN_PER_PIXEL * (Math.cos(pitch) < 0 ? -1 : 1)
      pitch += dy * TURN_PER_PIXEL
    }
    apply()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag = null
    element.style.cursor = ''
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, zoom * Math.exp(event.deltaY * ZOOM_PER_WHEEL_PIXEL)))
    options.onChange()
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerUp)
  element.addEventListener('wheel', onWheel, { passive: false })

  return {
    zoom: () => zoom,
    reset() {
      yaw = 0
      pitch = 0
      roll = 0
      zoom = 1
      apply()
    },
    dispose() {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerUp)
      element.removeEventListener('wheel', onWheel)
    },
  }
}
