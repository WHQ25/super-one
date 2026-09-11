import { describe, expect, it, vi } from 'vitest'

const requestNative = vi.fn()
vi.mock('./bridge', () => ({ requestNative: (...args: unknown[]) => requestNative(...args) }))

const { hasNativeHost, isPreviewableMermaid, previewMermaid } = await import('./mermaid-preview')

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

describe('previewMermaid', () => {
  it('accepts mermaid SVG and rejects paths, scripts, and empty markup', () => {
    expect(isPreviewableMermaid(SVG)).toBe(true)
    expect(isPreviewableMermaid('<svg>ok</svg>')).toBe(true)
    expect(isPreviewableMermaid('docs/diagram.svg')).toBe(false)
    expect(isPreviewableMermaid('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isPreviewableMermaid('<div>nope</div>')).toBe(false)
    expect(isPreviewableMermaid('')).toBe(false)
    expect(isPreviewableMermaid(undefined)).toBe(false)
  })

  it('asks the host to open the viewer with the rendered SVG', () => {
    requestNative.mockClear()
    previewMermaid(SVG)
    expect(requestNative).toHaveBeenCalledWith('previewMermaid', { svg: SVG })
  })

  it('is native only when the React Native bridge is present', () => {
    const previous = (globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView
    delete (globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView
    expect(hasNativeHost()).toBe(false)
    ;(globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage() {} }
    expect(hasNativeHost()).toBe(true)
    if (previous) (globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView = previous
    else delete (globalThis as { ReactNativeWebView?: unknown }).ReactNativeWebView
  })
})
