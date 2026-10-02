import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CadWorkerResponse } from './cad-worker'

const read = vi.hoisted(() => ({
  step: vi.fn(),
  iges: vi.fn(),
}))
vi.mock('occt-import-js', () => ({
  default: async () => ({ ReadStepFile: read.step, ReadIgesFile: read.iges }),
}))

const posted: Array<{ data: CadWorkerResponse; transfer: ArrayBuffer[] }> = []
const scope = { onmessage: null as null | ((event: { data: unknown }) => Promise<void>), postMessage: (data: CadWorkerResponse, options?: { transfer?: ArrayBuffer[] }) => posted.push({ data, transfer: options?.transfer ?? [] }) }

beforeAll(async () => {
  vi.stubGlobal('self', scope)
  vi.stubGlobal('fetch', async () => new Response(new ArrayBuffer(8)))
  await import('./cad-worker')
})

describe('CAD worker', () => {
  it('returns typed, transferable meshes and drops empty parts', async () => {
    read.step.mockReturnValue({ success: true, meshes: [
      { name: 'plate', color: [0.5, 0.5, 0.5], attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] } }, index: { array: [0, 1, 2] } },
      { attributes: { position: { array: [] } } },
    ] })
    await scope.onmessage!({ data: { format: 'step', bytes: new ArrayBuffer(4) } })
    const { data, transfer } = posted.at(-1)!
    expect(data.ok && data.meshes).toHaveLength(1)
    const mesh = data.ok ? data.meshes[0] : undefined
    expect(mesh?.position).toBeInstanceOf(Float32Array)
    expect(mesh?.index).toEqual(new Uint32Array([0, 1, 2]))
    expect(transfer).toHaveLength(3)
    expect(read.step).toHaveBeenCalledWith(expect.any(Uint8Array), { linearUnit: 'millimeter' })
  })

  it('reports a file OpenCascade cannot read', async () => {
    read.iges.mockReturnValue({ success: false, meshes: [] })
    await scope.onmessage!({ data: { format: 'iges', bytes: new ArrayBuffer(4) } })
    expect(posted.at(-1)!.data).toEqual({ ok: false, error: 'OpenCascade could not read this file' })
  })
})
