import { Box3, Group, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { frameBounds, viewCorrection } from './device-model-framing'

const FOV = 30
const ASPECT = 1.5
const MARGIN = 1.12

/** The fit used when the body sits on the origin: size, then half its depth. */
function centeredDistance(box: Box3): number {
  const size = box.getSize(new Vector3())
  const vertical = Math.tan((FOV * Math.PI) / 360)
  const horizontal = vertical * ASPECT
  return Math.max(size.y / 2 / vertical, size.x / 2 / horizontal) * MARGIN + size.z / 2
}

function expectMatrixClose(actual: Matrix4, expected: Matrix4) {
  for (let i = 0; i < 16; i++) expect(actual.elements[i]).toBeCloseTo(expected.elements[i]!, 5)
}

describe('frameBounds', () => {
  it('matches the centered size formula and aims at the origin', () => {
    const box = new Box3(new Vector3(-1.2, -2.4, -0.3), new Vector3(1.2, 2.4, 0.3))
    const framed = frameBounds(box, FOV, ASPECT, MARGIN)
    expect(framed.distance).toBeCloseTo(centeredDistance(box), 6)
    expect(framed.target.length()).toBeLessThan(1e-6)
  })

  it('recenters a shifted box and keeps the distance of its size', () => {
    const centered = new Box3(new Vector3(-1, -1, -0.2), new Vector3(1, 1, 0.2))
    const shifted = centered.clone().translate(new Vector3(3, -0.5, 0.4))
    const framed = frameBounds(shifted, FOV, ASPECT, MARGIN)
    expect(framed.distance).toBeCloseTo(frameBounds(centered, FOV, ASPECT, MARGIN).distance, 6)
    expect(framed.target.x).toBeCloseTo(3, 6)
    expect(framed.target.y).toBeCloseTo(-0.5, 6)
    expect(framed.target.z).toBeCloseTo(0.4, 6)

    const camera = new PerspectiveCamera(FOV, ASPECT, 0.01, 200)
    camera.position.set(framed.target.x, framed.target.y, framed.target.z + framed.distance)
    camera.lookAt(framed.target)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const center = framed.target.clone().project(camera)
    expect(center.x).toBeCloseTo(0, 4)
    expect(center.y).toBeCloseTo(0, 4)

    const parked = new PerspectiveCamera(FOV, ASPECT, 0.01, 200)
    parked.position.set(0, 0, framed.distance)
    parked.lookAt(0, 0, 0)
    parked.updateMatrixWorld()
    parked.updateProjectionMatrix()
    let peak = 0
    let escaped = false
    for (const x of [shifted.min.x, shifted.max.x]) {
      for (const y of [shifted.min.y, shifted.max.y]) {
        for (const z of [shifted.min.z, shifted.max.z]) {
          const ndc = new Vector3(x, y, z).project(camera)
          peak = Math.max(peak, Math.abs(ndc.x), Math.abs(ndc.y))
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 / MARGIN + 1e-4)
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 / MARGIN + 1e-4)
          expect(ndc.z).toBeLessThan(1)
          const missed = new Vector3(x, y, z).project(parked)
          if (Math.abs(missed.x) > 1 || Math.abs(missed.y) > 1) escaped = true
        }
      }
    }
    expect(peak).toBeGreaterThan(1 / MARGIN - 0.02)
    expect(escaped).toBe(true)
  })
})

describe('viewCorrection', () => {
  it('starts on the pose the drag held and ends on the form, with the view orbit kept', () => {
    const view = new Group()
    const align = new Group()
    const tilt = new Group()
    const stage = new Group()
    const root = new Group()
    view.add(align)
    align.add(tilt)
    tilt.add(stage)
    stage.add(root)

    view.rotation.set(0.2, -0.4, 0.1)
    tilt.rotation.set(-0.3, 0.15, 0)
    stage.rotation.z = 0.7
    root.position.set(0.4, -0.2, 0.1)
    root.rotation.set(0.2, 0.5, -0.3)
    view.updateMatrixWorld(true)
    const seen = root.matrixWorld.clone()

    tilt.rotation.set(0.4, -0.2, 0)
    stage.rotation.z = -1.1
    root.position.set(0, 0, 0)
    root.rotation.set(0, 0.1, 0)
    align.position.set(0, 0, 0)
    align.quaternion.identity()
    align.scale.set(1, 1, 1)
    view.updateMatrixWorld(true)
    const arrived = root.matrixWorld.clone()

    const correction = viewCorrection(seen, arrived, view.matrixWorld)
    correction.decompose(align.position, align.quaternion, align.scale)
    expect(align.scale.x).toBeCloseTo(1, 5)
    expect(align.scale.y).toBeCloseTo(1, 5)
    expect(align.scale.z).toBeCloseTo(1, 5)
    align.scale.set(1, 1, 1)
    view.updateMatrixWorld(true)
    expectMatrixClose(root.matrixWorld, seen)
    expect(align.quaternion.angleTo(new Quaternion())).toBeLessThanOrEqual(Math.PI + 1e-8)

    align.position.set(0, 0, 0)
    align.quaternion.identity()
    view.updateMatrixWorld(true)
    expectMatrixClose(root.matrixWorld, arrived)
  })

  it('takes the short arc across a three-quarter turn', () => {
    const seen = new Matrix4().makeRotationY((270 * Math.PI) / 180)
    const correction = viewCorrection(seen, new Matrix4(), new Matrix4())
    const angle = new Quaternion().setFromRotationMatrix(correction).angleTo(new Quaternion())
    expect(angle).toBeCloseTo(Math.PI / 2, 5)
    expect(angle).toBeLessThanOrEqual(Math.PI)
  })
})
