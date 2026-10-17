/** @vitest-environment jsdom */
import { resolve } from 'node:path'
import { Box3, Group, Ray, Raycaster, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { parseModel } from '../coding/model-loader'
import { foldableBody } from './device-model-body'
import { prepareDeviceModel, projectRayToScreen, transformFrame } from './device-model-scene'

/**
 * Run with SUPERONE_DEVICE_MODELS=1 outside the agent sandbox (usdcat runs under
 * sandbox-exec, which cannot nest). Needs Apple's models in apps/desktop/.device-models.
 */
const enabled = Boolean(process.env.SUPERONE_DEVICE_MODELS)

vi.mock('electron', () => ({
  app: { getAppPath: () => resolve(__dirname, '../../../../..'), getPath: () => '' },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

describe.skipIf(!enabled)('Apple device models', async () => {
  const { listDeviceModels, loadDeviceModel } = await import('../../../../main/device-models')
  const models = enabled ? await listDeviceModels() : []

  it('finds the models on disk', () => {
    expect(models.length).toBeGreaterThan(0)
  })

  for (const model of models) {
    it(model, async () => {
      const loaded = await loadDeviceModel(model)
      expect(loaded).not.toBeNull()
      const { archive, screen, fold } = loaded!
      const bytes = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
      const { object } = await parseModel('device.usdz', bytes)
      if (fold) { expectFoldable(object, fold); return }
      const prepared = prepareDeviceModel(object, screen)
      const frame = transformFrame(prepared.frame, prepared.root.matrixWorld)

      // Stood upright facing the camera: screen-right +X, screen-up +Y, out of the glass +Z.
      expect(frame.u.clone().normalize().x).toBeCloseTo(1, 3)
      expect(frame.v.clone().normalize().y).toBeCloseTo(1, 2)
      expect(frame.normal.z).toBeCloseTo(1, 3)
      const aspect = frame.u.length() / frame.v.length()
      expect(aspect).toBeGreaterThan(0.4)
      expect(aspect).toBeLessThan(0.8)

      // One device only: the body is barely larger than its glass.
      const size = new Box3().setFromObject(prepared.root, true).getSize(new Vector3())
      expect(size.x / frame.u.length()).toBeLessThan(1.25)
      expect(size.y / frame.v.length()).toBeLessThan(1.25)
      expect(size.z / frame.u.length()).toBeLessThan(0.25)

      // A ray straight at the glass centre lands on the framebuffer centre.
      const centre = frame.origin.clone().addScaledVector(frame.u, 0.5).addScaledVector(frame.v, 0.5)
      const ray = new Ray(centre.clone().add(new Vector3(0, 0, 50)), new Vector3(0, 0, -1))
      const hit = projectRayToScreen(ray, frame, false)
      expect(hit?.xRatio).toBeCloseTo(0.5, 3)
      expect(hit?.yRatio).toBeCloseTo(0.5, 3)
      // Near the top-left of the glass is near the framebuffer's origin.
      const nearTopLeft = frame.origin.clone().addScaledVector(frame.u, 0.1).addScaledVector(frame.v, 0.9)
      const corner = projectRayToScreen(new Ray(nearTopLeft.add(new Vector3(0, 0, 50)), new Vector3(0, 0, -1)), frame, false)
      expect(corner?.xRatio).toBeCloseTo(0.1, 3)
      expect(corner?.yRatio).toBeCloseTo(0.1, 3)
      // From behind, the body is in the way.
      expect(projectRayToScreen(new Ray(centre.clone().sub(new Vector3(0, 0, 50)), new Vector3(0, 0, 1)), frame, false)).toBeNull()

      console.info(`${model}: glass ${frame.u.length().toFixed(2)}×${frame.v.length().toFixed(2)}, body ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`)
    }, 60_000)
  }
})

/** Every pose stands the lit glass up facing the camera, and a centred ray finds its middle. */
function expectFoldable(object: Parameters<typeof foldableBody>[0], clip: { start: number; duration: number }) {
  const stage = new Group()
  const body = foldableBody(object, clip, { hingeDegrees: 180, panel: 'inner', panelRotation: 90 })
  stage.add(body.root)
  for (const pose of [
    { hingeDegrees: 0, panel: 'cover', panelRotation: 0 },
    { hingeDegrees: 90, panel: 'inner', panelRotation: 90 },
    { hingeDegrees: 180, panel: 'inner', panelRotation: 90 },
  ] as const) {
    body.fold(pose, false)
    stage.updateMatrixWorld(true)
    const frame = body.frame()
    expect(frame.normal.z, `${pose.hingeDegrees}° normal`).toBeCloseTo(1, 2)
    // The framebuffer's x runs right on the closed cover and down the opened panel,
    // whose portrait framebuffer lies turned under its landscape glass.
    const right = frame.u.clone().normalize()
    if (pose.panelRotation === 0) expect(right.x, `${pose.hingeDegrees}° right`).toBeCloseTo(1, 2)
    else expect(right.y, `${pose.hingeDegrees}° down`).toBeCloseTo(-1, 2)
    // Portrait in the framebuffer's own axes, whichever way the glass is laid.
    expect(frame.u.length()).toBeLessThan(frame.v.length())
    // Centred on the glass the picture is on.
    const centre = frame.origin.clone().addScaledVector(frame.u, 0.5).addScaledVector(frame.v, 0.5)
    const raycaster = new Raycaster(centre.clone().add(new Vector3(0, 0, 50)), new Vector3(0, 0, -1))
    const hit = body.point(raycaster, false)
    expect(hit?.xRatio, `${pose.hingeDegrees}° hit x`).toBeCloseTo(0.5, 1)
    expect(hit?.yRatio, `${pose.hingeDegrees}° hit y`).toBeCloseTo(0.5, 1)
    const size = body.bounds().getSize(new Vector3())
    console.info(`foldable at ${pose.hingeDegrees}°: glass ${frame.u.length().toFixed(2)}×${frame.v.length().toFixed(2)}, bounds ${size.toArray().map((v) => v.toFixed(2)).join('×')}`)
  }
}
