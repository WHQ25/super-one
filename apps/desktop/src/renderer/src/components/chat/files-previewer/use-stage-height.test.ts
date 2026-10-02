/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { PREVIEWER_STAGE_MIN_HEIGHT, useStageContentHeight } from './use-stage-height'

/** `data:` paths skip the media server; the fake image reads its size from the path. */
const SIZES: Record<string, [number, number] | null> = {
  'data:wide': [1600, 600],
  'data:tall': [400, 1200],
  'data:strip': [1600, 100],
  'data:broken': null,
}

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(url: string) {
    const size = SIZES[url]
    queueMicrotask(() => {
      if (!size) { this.onerror?.(); return }
      ;[this.naturalWidth, this.naturalHeight] = size
      this.onload?.()
    })
  }
}

const image = (absolutePath: string): PreviewerFile => ({ path: absolutePath, absolutePath, name: 'a.png', kind: 'image' })
const missing: PreviewerFile = { path: 'gone', absolutePath: '/repo/gone', name: 'gone', kind: 'missing' }
const text: PreviewerFile = { path: 'a.ts', absolutePath: '/repo/a.ts', name: 'a.ts', kind: 'text' }

describe('useStageContentHeight', () => {
  beforeEach(() => { vi.stubGlobal('Image', FakeImage) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('is the tallest media slide scaled down to the width', async () => {
    const { result } = renderHook(() => useStageContentHeight('/repo', [image('data:wide'), image('data:strip'), missing], 800))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(300))
  })

  it('never scales media up and never drops below the floor', async () => {
    const { result } = renderHook(() => useStageContentHeight('/repo', [image('data:strip'), image('data:broken')], 2000))
    await waitFor(() => expect(result.current).toBe(PREVIEWER_STAGE_MIN_HEIGHT))
  })

  it('follows the width', async () => {
    const { result, rerender } = renderHook(({ width }) => useStageContentHeight('/repo', [image('data:tall')], width), { initialProps: { width: 200 } })
    await waitFor(() => expect(result.current).toBe(600))
    rerender({ width: 1000 })
    expect(result.current).toBe(1200)
  })

  it('keeps the fixed card when a slide fills the stage or the width is unknown', async () => {
    const filled = renderHook(() => useStageContentHeight('/repo', [image('data:wide'), text], 800))
    const unmeasured = renderHook(() => useStageContentHeight('/repo', [image('data:wide')], 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(filled.result.current).toBeNull()
    expect(unmeasured.result.current).toBeNull()
  })
})
