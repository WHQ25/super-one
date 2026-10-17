import { Group, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { syntheticFoldableScene } from './__fixtures__/synthetic-device-model'
import { foldableBody, type DeviceModelFold } from './device-model-body'

const CLOSED: DeviceModelFold = { hingeDegrees: 0, panel: 'cover', panelRotation: 0 }
const HALF: DeviceModelFold = { hingeDegrees: 90, panel: 'inner', panelRotation: 90 }
const OPEN: DeviceModelFold = { hingeDegrees: 180, panel: 'inner', panelRotation: 90 }

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

  it('sweeps to a posture and settles where an instant fold would have put it', () => {
    const swept = staged(OPEN)
    swept.fold(CLOSED, true)
    expect(swept.step(performance.now())).toBe(true)
    expect(swept.step(performance.now() + 10_000)).toBe(false)
    const instant = staged(CLOSED)
    expect(swept.frame().origin.distanceTo(instant.frame().origin)).toBeLessThan(1e-6)
    expect(swept.bounds().getSize(new Vector3()).x).toBeCloseTo(instant.bounds().getSize(new Vector3()).x, 6)
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
