import { Box3, Mesh, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { syntheticPhoneScene, syntheticProScene, syntheticTabletScene } from './__fixtures__/synthetic-device-model'
import { prepareDeviceModel, projectRayToScreen, transformFrame, type DeviceScreenFrame } from './device-model-scene'

function worldFrame(prepared: ReturnType<typeof prepareDeviceModel>): DeviceScreenFrame {
  return transformFrame(prepared.frame, prepared.root.matrixWorld)
}

/** A ray fired straight down the view axis at a point on the glass. */
function aimAt(frame: DeviceScreenFrame, u: number, v: number, fromBehind = false): Ray {
  const target = frame.origin.clone().addScaledVector(frame.u, u).addScaledVector(frame.v, v)
  const direction = new Vector3(0, 0, fromBehind ? 1 : -1)
  return new Ray(target.sub(direction.clone().multiplyScalar(1)), direction)
}

describe('prepareDeviceModel', () => {
  it('stands the device upright, facing the camera, centred on the origin', () => {
    const prepared = prepareDeviceModel(syntheticProScene(), 'smallest')
    const frame = worldFrame(prepared)
    expect(frame.u.clone().normalize().x).toBeCloseTo(1)
    expect(frame.v.clone().normalize().y).toBeCloseTo(1)
    expect(frame.normal.z).toBeCloseTo(1)
    const center = new Box3().setFromObject(prepared.root, true).getCenter(new Vector3())
    expect(center.length()).toBeLessThan(1e-6)
  })

  it('picks one size out of a two-size scene and leaves the other behind', () => {
    const pro = prepareDeviceModel(syntheticProScene(), 'smallest')
    const max = prepareDeviceModel(syntheticProScene(), 'largest')
    expect(worldFrame(pro).u.length()).toBeCloseTo(0.066)
    expect(worldFrame(max).u.length()).toBeCloseTo(0.072)
    let screens = 0
    max.root.traverse((part) => { if (part instanceof Mesh && part.name === 'HkNSnYzBPABcqwM') screens++ })
    expect(screens).toBe(1)
  })

  it('refuses to guess which device a two-size scene means', () => {
    expect(() => prepareDeviceModel(syntheticProScene(), 'only')).toThrow('more than one device')
  })

  it('cuts a leaning tablet away from the keyboard it rests on', () => {
    const prepared = prepareDeviceModel(syntheticTabletScene(), 'only')
    const frame = worldFrame(prepared)
    // Landscape glass in the scene is still stood up by its own axes.
    expect(frame.normal.z).toBeCloseTo(1)
    const size = new Box3().setFromObject(prepared.root, true).getSize(new Vector3())
    expect(size.z).toBeLessThan(0.01)
  })

  it('reports a model with no glass', () => {
    const scene = syntheticPhoneScene()
    scene.traverse((part) => { if (part instanceof Mesh && part.name === 'HkNSnYzBPABcqwM') part.removeFromParent() })
    expect(() => prepareDeviceModel(scene, 'only')).toThrow('No device screen')
  })
})

describe('projectRayToScreen', () => {
  const frame = worldFrame(prepareDeviceModel(syntheticPhoneScene(), 'only'))

  it('maps the glass onto the framebuffer with the origin at the top left', () => {
    expect(projectRayToScreen(aimAt(frame, 0.5, 0.5), frame, false)).toEqual({ xRatio: expect.closeTo(0.5), yRatio: expect.closeTo(0.5) })
    expect(projectRayToScreen(aimAt(frame, 0.2, 0.9), frame, false)).toEqual({ xRatio: expect.closeTo(0.2), yRatio: expect.closeTo(0.1) })
  })

  it('misses off the glass unless the drag is pinned to its edge', () => {
    expect(projectRayToScreen(aimAt(frame, 1.2, 0.5), frame, false)).toBeNull()
    expect(projectRayToScreen(aimAt(frame, 1.2, 0.5), frame, true)).toEqual({ xRatio: 1, yRatio: expect.closeTo(0.5) })
  })

  it('never lands from behind the device', () => {
    expect(projectRayToScreen(aimAt(frame, 0.5, 0.5, true), frame, true)).toBeNull()
  })
})
