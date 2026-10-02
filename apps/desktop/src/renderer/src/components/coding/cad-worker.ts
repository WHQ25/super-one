import occtimportjs from 'occt-import-js'
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'

export interface CadWorkerRequest { format: 'step' | 'iges'; bytes: ArrayBuffer }
export interface CadMesh { name?: string; color?: [number, number, number]; position: Float32Array; normal?: Float32Array; index?: Uint32Array }
export type CadWorkerResponse = { ok: true; meshes: CadMesh[] } | { ok: false; error: string }

// One file per worker: terminating it is the only way to give the wasm heap back.
self.onmessage = async ({ data }: MessageEvent<CadWorkerRequest>) => {
  try {
    const occt = await occtimportjs({ wasmBinary: await (await fetch(wasmUrl)).arrayBuffer() })
    const input = new Uint8Array(data.bytes)
    const params = { linearUnit: 'millimeter' } as const
    const result = data.format === 'iges' ? occt.ReadIgesFile(input, params) : occt.ReadStepFile(input, params)
    if (!result.success) throw new Error('OpenCascade could not read this file')
    const transfer: ArrayBuffer[] = []
    const meshes = result.meshes.filter(mesh => mesh.attributes.position.array.length > 0).map((mesh): CadMesh => {
      const position = Float32Array.from(mesh.attributes.position.array)
      const normal = mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : undefined
      const index = mesh.index ? Uint32Array.from(mesh.index.array) : undefined
      for (const array of [position, normal, index]) if (array) transfer.push(array.buffer as ArrayBuffer)
      return { name: mesh.name, color: mesh.color, position, normal, index }
    })
    self.postMessage({ ok: true, meshes } satisfies CadWorkerResponse, { transfer })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies CadWorkerResponse)
  }
}
