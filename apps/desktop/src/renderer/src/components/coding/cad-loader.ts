import { BufferAttribute, BufferGeometry, Color, SRGBColorSpace } from 'three'
import { CAD_MODEL_EXTENSIONS, extensionOf } from '@superone/shared/file-preview'
import { meshModel, type LoadedModel } from './model-loader'
import type { CadWorkerRequest, CadWorkerResponse } from './cad-worker'

export function isCadModel(name: string): boolean {
  return CAD_MODEL_EXTENSIONS.has(extensionOf(name))
}

/**
 * Tessellates STEP/IGES with OpenCascade off the UI thread. The worker, its
 * 7.6 MB wasm and its heap load only for a CAD file and end with it.
 */
export function parseCadModel(name: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<LoadedModel> {
  const ext = extensionOf(name)
  const request: CadWorkerRequest = { format: ext === '.iges' || ext === '.igs' ? 'iges' : 'step', bytes: bytes.slice(0) }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cad-worker.ts', import.meta.url), { type: 'module', name: 'cad-import' })
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { finish(); reject(new DOMException('CAD import cancelled', 'AbortError')) }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<CadWorkerResponse>) => {
      finish()
      if (!data.ok) { reject(new Error(data.error)); return }
      const model = meshModel(...data.meshes.map(mesh => {
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(mesh.position, 3))
        if (mesh.normal) geometry.setAttribute('normal', new BufferAttribute(mesh.normal, 3))
        else geometry.computeVertexNormals()
        if (mesh.index) geometry.setIndex(new BufferAttribute(mesh.index, 1))
        return { geometry, name: mesh.name, color: mesh.color && new Color().setRGB(...mesh.color, SRGBColorSpace) }
      }))
      // CAD is Z-up; the preview's ground and camera are Y-up.
      model.object.rotation.x = -Math.PI / 2
      resolve(model)
    }
    worker.onerror = event => { finish(); reject(new Error(event.message || 'The CAD importer failed')) }
    // A copy: the preview keeps its bytes to re-render without refetching.
    worker.postMessage(request, [request.bytes])
  })
}
