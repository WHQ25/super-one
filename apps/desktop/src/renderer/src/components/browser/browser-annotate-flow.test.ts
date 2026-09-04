/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleAnnotationMessage } from './browser-annotate-flow'
import { browserExecJs, browserCapture } from './browser-host-api'

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    addBrowserAnnotation: vi.fn(),
    updateBrowserAnnotation: vi.fn(),
    removeBrowserAnnotation: vi.fn(),
  },
}))

vi.mock('@/stores/chat', () => ({ useChatStore: { getState: () => mockStore } }))
vi.mock('./browser-host-api', () => ({
  browserExecJs: vi.fn().mockResolvedValue(undefined),
  browserCapture: vi.fn().mockResolvedValue({
    isEmpty: () => false,
    getSize: () => ({ width: 10, height: 10 }),
    toDataURL: () => 'data:image/png;base64,YWJj',
  }),
}))
// Compositing the canvas colour is covered in browser-canvas.test.ts; here it would
// only re-encode the fixture and obscure what this file is about.
vi.mock('./browser-canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./browser-canvas')>()),
  flattenBrowserCapture: (image: Electron.NativeImage) => Promise.resolve(image.toDataURL()),
}))

const RECT = { x: 0, y: 0, width: 10, height: 10 }

describe('handleAnnotationMessage dispatch', () => {
  beforeEach(() => {
    mockStore.addBrowserAnnotation.mockClear()
    mockStore.updateBrowserAnnotation.mockClear()
    mockStore.removeBrowserAnnotation.mockClear()
    vi.mocked(browserExecJs).mockClear()
    vi.mocked(browserCapture).mockClear()
  })

  it('commit routes to addBrowserAnnotation with payload id (no regen)', async () => {
    await handleAnnotationMessage('/b', {
      op: 'commit', id: 'a1', kind: 'element', rect: RECT, selector: '#b',
      comment: 'c', wantScreenshot: false, styleChanges: [], pageUrl: '', pageTitle: '',
    })
    expect(mockStore.addBrowserAnnotation).toHaveBeenCalledTimes(1)
    const arg = mockStore.addBrowserAnnotation.mock.calls[0][0]
    expect(arg.id).toBe('a1')
    expect(arg.screenshot).toBeNull()
    expect(mockStore.updateBrowserAnnotation).not.toHaveBeenCalled()
  })

  it('update routes to updateBrowserAnnotation and re-captures screenshot when wantScreenshot', async () => {
    await handleAnnotationMessage('/b', {
      op: 'update', id: 'a1', kind: 'region', rect: RECT, selector: null,
      comment: 'c2', wantScreenshot: true, styleChanges: [{ property: 'color', previousValue: '#000', value: '#f00' }], pageUrl: '', pageTitle: '',
    })
    expect(mockStore.updateBrowserAnnotation).toHaveBeenCalledWith('a1', {
      comment: 'c2',
      styleChanges: [{ property: 'color', previousValue: '#000', value: '#f00' }],
      screenshot: 'YWJj',
    })
    expect(browserCapture).toHaveBeenCalledWith('/b', RECT)
    expect(mockStore.addBrowserAnnotation).not.toHaveBeenCalled()
  })

  it('update with wantScreenshot false clears screenshot to null', async () => {
    await handleAnnotationMessage('/b', {
      op: 'update', id: 'a1', kind: 'element', rect: RECT, selector: '#b',
      comment: 'c2', wantScreenshot: false, styleChanges: [], pageUrl: '', pageTitle: '',
    })
    expect(mockStore.updateBrowserAnnotation).toHaveBeenCalledWith('a1', { comment: 'c2', styleChanges: [], screenshot: null })
    expect(browserCapture).not.toHaveBeenCalled()
  })

  it('delete routes to removeBrowserAnnotation', async () => {
    await handleAnnotationMessage('/b', { op: 'delete', id: 'a1' })
    expect(mockStore.removeBrowserAnnotation).toHaveBeenCalledWith('a1')
    expect(mockStore.addBrowserAnnotation).not.toHaveBeenCalled()
  })

  it('malformed payload is ignored', async () => {
    await handleAnnotationMessage('/b', { op: 'commit', id: 'a1' })
    expect(mockStore.addBrowserAnnotation).not.toHaveBeenCalled()
  })
})
