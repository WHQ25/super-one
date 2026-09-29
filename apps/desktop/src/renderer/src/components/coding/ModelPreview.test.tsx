/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BoxGeometry, Mesh, Vector3, type PerspectiveCamera } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPreviewViewState } from './ModelPreview'

const { controlsInstances } = vi.hoisted(() => ({ controlsInstances: [] as Array<{ camera: PerspectiveCamera; emitChange: () => void }> }))

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  class FakeRenderer {
    domElement = document.createElement('canvas')
    outputColorSpace = ''
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...three, WebGLRenderer: FakeRenderer }
})

vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3: V3 } = await vi.importActual<typeof import('three')>('three')
  class FakeOrbitControls {
    target = new V3()
    enabled = true
    enableDamping = false
    private listeners = new Set<() => void>()
    constructor(public camera: PerspectiveCamera) {
      controlsInstances.push({ camera, emitChange: () => this.listeners.forEach((listener) => listener()) })
    }
    update() { return false }
    addEventListener(_type: string, listener: () => void) { this.listeners.add(listener) }
    removeEventListener(_type: string, listener: () => void) { this.listeners.delete(listener) }
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls }
})

vi.mock('./model-loader', async (importOriginal) => ({
  ...await importOriginal<typeof import('./model-loader')>(),
  parseModel: async () => ({ object: new Mesh(new BoxGeometry()), animations: [] }),
  disposeModel: () => {},
}))

vi.mock('./model-environment', () => ({ addModelFillLights: () => {}, lightModel: () => () => {} }))

import { ModelPreview } from './ModelPreview'

const SAVED: ModelPreviewViewState = { cameraPosition: [1, 2, 3], target: [0.5, 0, 0] }

async function loadedCamera(): Promise<PerspectiveCamera> {
  await waitFor(() => expect(controlsInstances).toHaveLength(1))
  return controlsInstances[0].camera
}

describe('ModelPreview view state', () => {
  beforeEach(() => {
    controlsInstances.length = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('opens at a saved view without reporting the default view over it', async () => {
    const onViewStateChange = vi.fn()
    render(<ModelPreview src="/m.glb" name="m.glb" initialViewState={SAVED} onViewStateChange={onViewStateChange} />)

    expect((await loadedCamera()).position.toArray()).toEqual(SAVED.cameraPosition)
    expect(onViewStateChange).not.toHaveBeenCalled()
  })

  it('reports orbiting and the reset view', async () => {
    const onViewStateChange = vi.fn()
    render(<ModelPreview src="/m.glb" name="m.glb" initialViewState={SAVED} onViewStateChange={onViewStateChange} />)
    const camera = await loadedCamera()

    camera.position.set(4, 5, 6)
    controlsInstances[0].emitChange()
    expect(onViewStateChange).toHaveBeenLastCalledWith({ cameraPosition: [4, 5, 6], target: SAVED.target })

    fireEvent.click(await screen.findByTitle('Reset view'))
    const reset = onViewStateChange.mock.lastCall![0] as ModelPreviewViewState
    expect(reset.cameraPosition).not.toEqual([4, 5, 6])
    expect(reset.target).toEqual([0, 0, 0])
  })

  it('keeps a non-interactive preview on the latest view', async () => {
    const { rerender } = render(<ModelPreview src="/m.glb" name="m.glb" interactive={false} initialViewState={null} />)
    const camera = await loadedCamera()
    await waitFor(() => expect(screen.queryByTestId('model-preview')?.querySelector('canvas')).not.toBeNull())

    rerender(<ModelPreview src="/m.glb" name="m.glb" interactive={false} initialViewState={SAVED} />)
    expect(camera.position.toArray()).toEqual(SAVED.cameraPosition)
  })

  it('does not move an interactive camera to an echoed view', async () => {
    const { rerender } = render(<ModelPreview src="/m.glb" name="m.glb" initialViewState={null} />)
    const camera = await loadedCamera()
    await waitFor(() => expect(screen.queryByTestId('model-preview')?.querySelector('canvas')).not.toBeNull())
    const before = camera.position.clone()

    rerender(<ModelPreview src="/m.glb" name="m.glb" initialViewState={SAVED} />)
    expect(camera.position.equals(before)).toBe(true)
    expect(camera.position.equals(new Vector3(...SAVED.cameraPosition))).toBe(false)
  })
})
