import { Group, Mesh, Quaternion, Raycaster, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { syntheticFoldableScene, syntheticSkinnedFoldableScene } from './__fixtures__/synthetic-device-model'
import { HINGE_DEGREES_PER_SECOND, HINGE_MAX_MOVE_MS, foldableBody, type DeviceModelFold } from './device-model-body'

const CLOSED: DeviceModelFold = { hingeDegrees: 0, panel: 'cover', panelRotation: 0, laptop: false }
const HALF: DeviceModelFold = { hingeDegrees: 90, panel: 'inner', panelRotation: 90, laptop: false }
const OPEN: DeviceModelFold = { hingeDegrees: 180, panel: 'inner', panelRotation: 90, laptop: false }

function staged(initial: DeviceModelFold) {
  const stage = new Group()
  const body = foldableBody(syntheticFoldableScene(), { start: 0, duration: 1 }, initial)
  stage.add(body.root)
  stage.updateMatrixWorld(true)
  return body
}

/** Straight down the view axis at framebuffer point (x, y) of the lit glass. */
function aimAt(body: ReturnType<typeof staged>, x: number, y: number): Raycaster {
  const frame = body.frame()
  const target = frame.origin.clone().addScaledVector(frame.u, x).addScaledVector(frame.v, 1 - y)
  return new Raycaster(target.add(new Vector3(0, 0, 1)), new Vector3(0, 0, -1))
}

describe('foldableBody', () => {
  it('turns whichever screen is lit to face the camera, in every posture', () => {
    const body = staged(OPEN)
    for (const pose of [CLOSED, HALF, OPEN]) {
      body.fold(pose, false)
      const frame = body.frame()
      expect(frame.normal.z).toBeCloseTo(1, 3)
      const hit = body.point(aimAt(body, 0.5, 0.5), false)
      expect(hit?.xRatio).toBeCloseTo(0.5, 2)
      expect(hit?.yRatio).toBeCloseTo(0.5, 2)
    }
  })

  it('keeps a fold opening in the shut pose, and aims the cover once it is a tent', () => {
    const shut = staged(CLOSED)
    const facing = shut.root.quaternion.clone()
    const at = shut.root.position.clone()

    const cracked = staged(CLOSED)
    cracked.fold({ ...CLOSED, hingeDegrees: 30 }, false)
    expect(cracked.hinge()).toBe(30)
    expect(cracked.root.quaternion.angleTo(facing)).toBeCloseTo(0, 5)
    expect(cracked.root.position.distanceTo(at)).toBeCloseTo(0, 5)
    // The cover has opened with the clip. The phone was not turned to follow it.
    expect(cracked.frame().normal.z).toBeLessThan(0.999)

    const swept = staged(CLOSED)
    const start = performance.now()
    swept.fold({ ...CLOSED, hingeDegrees: 30 }, true)
    expect(swept.step(start + 300)).toBe(true)
    expect(swept.root.quaternion.angleTo(facing)).toBeCloseTo(0, 5)
    expect(swept.step(start + 1000)).toBe(false)
    expect(swept.hinge()).toBe(30)
    expect(swept.root.quaternion.angleTo(facing)).toBeCloseTo(0, 5)
    expect(swept.root.position.distanceTo(at)).toBeCloseTo(0, 5)

    const fromOpen = staged(OPEN)
    const opened = performance.now()
    fromOpen.fold({ ...CLOSED, hingeDegrees: 20 }, true)
    expect(fromOpen.step(opened + HINGE_MAX_MOVE_MS + 20)).toBe(false)
    expect(fromOpen.hinge()).toBe(20)
    expect(fromOpen.root.quaternion.angleTo(facing)).toBeCloseTo(0, 5)

    const tent = staged(CLOSED)
    tent.fold({ ...CLOSED, hingeDegrees: 31 }, false)
    expect(tent.frame().normal.z).toBeCloseTo(1, 3)
    expect(tent.root.quaternion.angleTo(facing)).toBeGreaterThan(1e-3)
  })

  it('faces an opened cover to the camera, keeping touches on its glass', () => {
    const body = staged(CLOSED)
    body.fold({ ...CLOSED, hingeDegrees: 45 }, false)
    // Face on: the renderer stands the tent and looks round its open end.
    expect(body.frame().normal.z).toBeCloseTo(1, 3)
    const hit = body.point(aimAt(body, 0.3, 0.7), false)
    expect(hit?.xRatio).toBeCloseTo(0.3, 2)
    expect(hit?.yRatio).toBeCloseTo(0.7, 2)
  })

  it('lays the opened panel\'s portrait framebuffer turned under its landscape glass', () => {
    const body = staged(OPEN)
    const frame = body.frame()
    // The framebuffer's x runs down the glass, and it is portrait in its own axes.
    expect(frame.u.clone().normalize().y).toBeCloseTo(-1, 3)
    expect(frame.u.length()).toBeLessThan(frame.v.length())
    const hit = body.point(aimAt(body, 0.3, 0.2), false)
    expect(hit?.xRatio).toBeCloseTo(0.3, 2)
    expect(hit?.yRatio).toBeCloseTo(0.2, 2)
  })

  it('maps each half of a half-open glass onto its own half of the framebuffer', () => {
    const body = staged(HALF)
    // Seen from the camera the fold runs top to bottom; the left half is the far end
    // of the framebuffer's y, which the turn carries across the screen.
    const leftHalf = body.point(new Raycaster(new Vector3(-0.02, 0, 1), new Vector3(0, 0, -1)), false)
    const rightHalf = body.point(new Raycaster(new Vector3(0.02, 0, 1), new Vector3(0, 0, -1)), false)
    expect(leftHalf!.yRatio).toBeGreaterThan(0.5)
    expect(rightHalf!.yRatio).toBeLessThan(0.5)
  })

  it('turns a short move at the set rate', () => {
    const body = staged(HALF)
    const start = performance.now()
    body.fold({ ...HALF, hingeDegrees: 90 + HINGE_DEGREES_PER_SECOND / 2 }, true)
    // Half a second's worth of travel takes half a second.
    expect(body.step(start + 250)).toBe(true)
    expect(body.step(start + 520)).toBe(false)
  })

  it('speeds a wide move up to finish within the cap, settling where an instant fold would', () => {
    const swept = staged(OPEN)
    const start = performance.now()
    swept.fold(HALF, true)
    // 90 degrees would take two seconds at the set rate; it takes the cap instead.
    expect(swept.step(start + HINGE_MAX_MOVE_MS / 2)).toBe(true)
    expect(swept.hinge()).toBeCloseTo(135, 0)
    expect(swept.step(start + HINGE_MAX_MOVE_MS + 20)).toBe(false)
    expect(swept.hinge()).toBe(90)
    const instant = staged(HALF)
    expect(swept.frame().origin.distanceTo(instant.frame().origin)).toBeLessThan(1e-6)
    expect(swept.bounds().getSize(new Vector3()).x).toBeCloseTo(instant.bounds().getSize(new Vector3()).x, 6)
  })

  it('carries on from where it is when sent somewhere new mid-move', () => {
    const body = staged(OPEN)
    const start = performance.now()
    body.fold(HALF, true)
    body.step(start + HINGE_MAX_MOVE_MS / 3)
    const reached = body.hinge()
    expect(reached).toBeLessThan(180)
    expect(reached).toBeGreaterThan(90)

    body.fold(OPEN, true)
    // No jump back to either end: the new move starts at the angle already reached.
    expect(body.hinge()).toBe(reached)
  })

  it('turns the screen it is told to face to the camera, leaving the picture on the lit one', () => {
    const body = staged(CLOSED)
    // Held open before the guest has swapped: the inner glass faces the camera, the cover stays lit.
    body.fold({ ...OPEN, panel: 'cover', panelRotation: 0, facing: 'inner' }, false)
    expect(body.frame().normal.z).toBeLessThan(0)
    body.fold(OPEN, false)
    expect(body.frame().normal.z).toBeCloseTo(1, 3)
  })

  it('pins the half without the cover while a drag scrubs, then places it when the drag ends', () => {
    const body = staged(OPEN)
    // The stage is already turned, as a drag finds it. The pin is in the world, not in the root.
    const stage = body.root.parent!
    stage.rotation.set(0.4, 0.7, -0.2)
    stage.position.set(0.3, -0.2, 1)
    stage.updateMatrixWorld(true)
    const start = performance.now()
    body.fold(CLOSED, true)
    body.step(start + HINGE_MAX_MOVE_MS / 2)

    const plain = body.root.getObjectByName('RgHyJuKiLoPmNbV')!
    const plainPoint = plain.children.find((child) => child instanceof Mesh)!
    const cover = body.root.getObjectByName('zaWsadDZpWAUDAX')!
    const plainAt = new Vector3()
    const plainFacing = new Quaternion()
    const coverAt = new Vector3()
    plainPoint.getWorldPosition(plainAt)
    plain.getWorldQuaternion(plainFacing)
    cover.getWorldPosition(coverAt)
    const rootFacing = body.root.quaternion.clone()

    body.scrub(150)

    expect(body.hinge()).toBe(150)
    expect(plain.getWorldQuaternion(new Quaternion()).angleTo(plainFacing)).toBeCloseTo(0, 5)
    expect(plainPoint.getWorldPosition(new Vector3()).distanceTo(plainAt)).toBeCloseTo(0, 5)
    expect(cover.getWorldPosition(new Vector3()).distanceTo(coverAt)).toBeGreaterThan(1e-3)
    expect(body.root.quaternion.angleTo(rootFacing)).toBeGreaterThan(1e-3)
    // The pose leg is gone, and a further scrub still holds the half the drag began on.
    expect(body.step(start + HINGE_MAX_MOVE_MS + 20)).toBe(false)
    body.scrub(40)
    expect(body.hinge()).toBe(40)
    expect(plain.getWorldQuaternion(new Quaternion()).angleTo(plainFacing)).toBeCloseTo(0, 5)
    expect(plainPoint.getWorldPosition(new Vector3()).distanceTo(plainAt)).toBeCloseTo(0, 5)

    // The facing check is in world space. The stage turn above is the host's, undone here
    // so the release is judged the same way as a fold with the stage at rest.
    stage.rotation.set(0, 0, 0)
    stage.position.set(0, 0, 0)
    stage.updateMatrixWorld(true)
    body.fold({ ...OPEN, facing: 'inner' }, false)
    expect(body.hinge()).toBe(180)
    expect(body.frame().normal.z).toBeCloseTo(1, 3)
  })

  it('pins the skinned half without the cover, as on the Duo', () => {
    const stage = new Group()
    stage.rotation.y = 0.5
    const body = foldableBody(syntheticSkinnedFoldableScene(), { start: 0, duration: 1 }, OPEN)
    stage.add(body.root)
    stage.updateMatrixWorld(true)
    const inner = body.root.getObjectByName('innerGlass') as SkinnedMesh
    const cover = body.root.getObjectByName('coverGlass') as SkinnedMesh
    const position = inner.geometry.getAttribute('position')
    let plainIndex = 0
    for (let i = 0; i < position.count; i++) if (position.getX(i) > 0) plainIndex = i
    const plainAt = inner.localToWorld(inner.getVertexPosition(plainIndex, new Vector3()))
    const coverAt = cover.localToWorld(cover.getVertexPosition(0, new Vector3()))

    body.scrub(0)

    const plainNow = inner.localToWorld(inner.getVertexPosition(plainIndex, new Vector3()))
    const coverNow = cover.localToWorld(cover.getVertexPosition(0, new Vector3()))
    expect(body.hinge()).toBe(0)
    expect(plainNow.distanceTo(plainAt)).toBeCloseTo(0, 4)
    expect(coverNow.distanceTo(coverAt)).toBeGreaterThan(1e-3)
  })

  it('keeps a drag that leaves the glass where it left, and misses otherwise', () => {
    const body = staged(OPEN)
    const inside = body.point(aimAt(body, 0.4, 0.6), true)
    const away = new Raycaster(new Vector3(5, 5, 1), new Vector3(0, 0, -1))
    expect(body.point(away, false)).toBeNull()
    expect(body.point(away, true)).toEqual(inside)
  })

  it('stands the cover up by itself, without the stage turning for it', () => {
    const body = staged(CLOSED)
    expect(body.turnOffset()).toBe(0)
    body.fold(OPEN, false)
    expect(body.turnOffset()).toBe(90)
  })
})
