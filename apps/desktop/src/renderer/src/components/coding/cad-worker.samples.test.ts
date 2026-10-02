import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CadWorkerResponse } from './cad-worker'

/** Run with SUPERONE_CAD_SAMPLES=<dir of .step/.stp/.iges/.igs files>, e.g. occt-import-js test/testfiles/cax-if. */
const sampleDir = process.env.SUPERONE_CAD_SAMPLES
const replies: CadWorkerResponse[] = []
const scope = { onmessage: null as null | ((event: { data: unknown }) => Promise<void>), postMessage: (data: CadWorkerResponse) => replies.push(data) }

async function importFile(path: string): Promise<CadWorkerResponse> {
  const bytes = await readFile(path)
  await scope.onmessage!({ data: { format: /\.ig/i.test(path) ? 'iges' : 'step', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
  return replies.at(-1)!
}

describe('the real OpenCascade worker', () => {
  beforeAll(async () => {
    const wasm = await readFile(createRequire(import.meta.url).resolve('occt-import-js/dist/occt-import-js.wasm'))
    vi.stubGlobal('self', scope)
    vi.stubGlobal('fetch', async () => new Response(wasm))
    await import('./cad-worker')
  })

  it('tessellates the repository box in millimetres', async () => {
    const reply = await importFile(join(__dirname, '__fixtures__/box.step'))
    const position = reply.ok ? reply.meshes[0].position : new Float32Array()
    expect(reply.ok && reply.meshes[0].index?.length).toBe(36)
    expect(Math.max(...position.filter((_, i) => i % 3 === 2))).toBeCloseTo(10)
  }, 60_000)

  describe.skipIf(!sampleDir)('downloaded samples', () => {
    for (const name of sampleDir ? readdirSync(sampleDir).filter(file => /\.(step|stp|iges|igs)$/i.test(file)) : []) {
      it(name, async () => {
        const reply = await importFile(join(sampleDir!, name))
        expect(reply.ok && reply.meshes.length).toBeGreaterThan(0)
      }, 60_000)
    }
  })
})
