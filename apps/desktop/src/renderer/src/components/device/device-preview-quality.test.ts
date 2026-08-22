import { describe, expect, it } from 'vitest'
import {
  readPreviewQuality,
  scaledPreviewSize,
  writePreviewQuality,
} from './device-preview-quality'

function storage(initial?: string) {
  const cell = { value: initial ?? null as string | null }
  return {
    getItem: () => cell.value,
    setItem: (_key: string, value: string) => { cell.value = value },
    read: () => cell.value,
  }
}

describe('iOS Simulator preview quality preference', () => {
  it('round-trips a chosen quality', () => {
    const store = storage()
    writePreviewQuality({ scale: 0.5, maxFrameRate: 30 }, store)
    expect(readPreviewQuality(store)).toEqual({ scale: 0.5, maxFrameRate: 30 })
  })

  it('falls back to native when nothing has been chosen', () => {
    expect(readPreviewQuality(storage())).toEqual({ scale: 1, maxFrameRate: 0 })
  })

  it('keeps the old iOS preference after the storage key migration', () => {
    const store = {
      getItem: (key: string) => key === 'superone.iosSimulator.previewQuality'
        ? JSON.stringify({ scale: 0.75, maxFrameRate: 30 })
        : null,
    }

    expect(readPreviewQuality(store)).toEqual({ scale: 0.75, maxFrameRate: 30 })
  })

  it('drops values the menu does not offer', () => {
    // A hand-edited or outdated entry must not pin the encoder to an odd size the
    // menu can never show or undo.
    const store = storage(JSON.stringify({ scale: 0.42, maxFrameRate: 999 }))
    expect(readPreviewQuality(store)).toEqual({ scale: 1, maxFrameRate: 0 })
  })

  it('survives a corrupt entry', () => {
    expect(readPreviewQuality(storage('{not json'))).toEqual({ scale: 1, maxFrameRate: 0 })
  })
})

describe('iOS Simulator scaled preview size', () => {
  it('rounds to even pixels the way the helper encoder does', () => {
    // 1179 x 0.5 lands on 589.5; an odd width costs a chroma column and some H.264
    // encoders reject it outright.
    expect(scaledPreviewSize(1179, 2556, 0.5)).toEqual({ width: 590, height: 1278 })
  })

  it('leaves the native size untouched', () => {
    expect(scaledPreviewSize(1179, 2556, 1)).toEqual({ width: 1179, height: 2556 })
  })
})
