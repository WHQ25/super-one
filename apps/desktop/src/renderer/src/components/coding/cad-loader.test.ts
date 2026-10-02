/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Mesh, type MeshStandardMaterial } from 'three'
import { isCadModel, parseCadModel } from './cad-loader'
import type { CadWorkerRequest, CadWorkerResponse } from './cad-worker'

class FakeWorker {
  static last: FakeWorker
  onmessage: ((event: MessageEvent<CadWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  request?: CadWorkerRequest
  transfer?: Transferable[]
  terminate = vi.fn()
  constructor() { FakeWorker.last = this }
  postMessage(request: CadWorkerRequest, transfer: Transferable[]) { this.request = request; this.transfer = transfer }
  reply(data: CadWorkerResponse) { this.onmessage?.({ data } as MessageEvent<CadWorkerResponse>) }
}
vi.stubGlobal('Worker', FakeWorker)
afterEach(() => vi.clearAllMocks())

const triangle = () => ({ position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]) })

describe('CAD model loading', () => {
  it('recognizes STEP and IGES in any case', () => {
    expect(['a.step', 'a.STP', 'a.iges', 'a.IGS'].every(isCadModel)).toBe(true)
    expect(isCadModel('a.stl')).toBe(false)
  })

  it('sends a copy of the file to a worker and builds one colored mesh per part', async () => {
    const bytes = new TextEncoder().encode('ISO-10303-21;').buffer as ArrayBuffer
    const pending = parseCadModel('bracket.step', bytes)
    const worker = FakeWorker.last
    expect(worker.request?.format).toBe('step')
    expect(worker.transfer).toEqual([worker.request?.bytes])
    expect(bytes.byteLength).toBeGreaterThan(0)
    worker.reply({ ok: true, meshes: [{ ...triangle(), name: 'plate', color: [1, 0, 0] }, triangle()] })
    const meshes: Mesh[] = []
    ;(await pending).object.traverse(part => { if (part instanceof Mesh) meshes.push(part) })
    expect(meshes.map(mesh => mesh.name)).toEqual(['plate', ''])
    expect((meshes[0].material as MeshStandardMaterial).color.getHex()).toBe(0xff0000)
    // OpenCascade may omit normals; the preview still needs them for lighting.
    expect(meshes[1].geometry.hasAttribute('normal')).toBe(true)
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('stands Z-up CAD parts on the Y-up preview ground', async () => {
    const pending = parseCadModel('plate.step', new ArrayBuffer(1))
    FakeWorker.last.reply({ ok: true, meshes: [triangle()] })
    expect((await pending).object.rotation.x).toBeCloseTo(-Math.PI / 2)
  })

  it('reads IGES with the IGES importer', () => {
    void parseCadModel('part.igs', new ArrayBuffer(1)).catch(() => {})
    expect(FakeWorker.last.request?.format).toBe('iges')
  })

  it('rejects with the importer error and stops the worker when cancelled', async () => {
    const failed = parseCadModel('bad.step', new ArrayBuffer(1))
    FakeWorker.last.reply({ ok: false, error: 'OpenCascade could not read this file' })
    await expect(failed).rejects.toThrow('OpenCascade could not read this file')

    const abort = new AbortController()
    const cancelled = parseCadModel('big.step', new ArrayBuffer(1), abort.signal)
    abort.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.last.terminate).toHaveBeenCalled()
  })
})
