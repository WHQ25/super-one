// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMiniAppMessage, handleMiniAppWorkerMessage } from './miniapp-message-handler'
import * as externalLink from '@/lib/external-link'
import * as clipboardLib from '@/lib/miniapp-clipboard'

const mockMiniapp = {
  toolResult: vi.fn(),
  fsRequest: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve('ok')),
  gitRequest: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve('ok')),
  fsWatch: vi.fn(() => Promise.resolve(42)),
  fsUnwatch: vi.fn(),
}

const mockApp = {
  openExternalLink: vi.fn(),
  clipboardRead: vi.fn(() => Promise.resolve('clipboard-text')),
  clipboardWrite: vi.fn(() => Promise.resolve()),
}

const mockSetDraftText = vi.fn()
const mockSetMiniAppContext = vi.fn()
const mockClearMiniAppContext = vi.fn()
vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      setDraftText: mockSetDraftText,
      setMiniAppContext: mockSetMiniAppContext,
      clearMiniAppContext: mockClearMiniAppContext,
    }),
  },
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: {
    getState: () => ({
      apps: [{ id: 'test-app', manifest: { name: 'Test App' } }],
    }),
  },
}))

const mockMediaStart = vi.fn()
const mockMediaEndTrack = vi.fn()
vi.mock('@/stores/miniapp-media', () => ({
  useMiniAppMediaStore: {
    getState: () => ({
      start: mockMediaStart,
      endTrack: mockMediaEndTrack,
    }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).miniapp = mockMiniapp
  ;(window as any).app = mockApp
})

describe('handleMiniAppMessage', () => {
  const appId = 'test-app'
  const projectDir = '/proj'
  const send = vi.fn()

  it('returns false for unknown message types', () => {
    expect(handleMiniAppMessage('unknown-type', {}, appId, projectDir, send)).toBe(false)
  })

  it('handles miniapp-tool-result', () => {
    const result = handleMiniAppMessage('miniapp-tool-result', {
      callId: 'c1', result: { ok: true }, error: undefined,
    }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockMiniapp.toolResult).toHaveBeenCalledWith('c1', { ok: true }, undefined)
  })

  it('handles miniapp-sendPrompt', () => {
    const result = handleMiniAppMessage('miniapp-sendPrompt', { text: 'hello' }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockSetDraftText).toHaveBeenCalledWith('hello')
  })

  it('handles miniapp-fs-request and sends response', async () => {
    mockMiniapp.fsRequest.mockResolvedValue({ files: [] })
    const result = handleMiniAppMessage('miniapp-fs-request', {
      appId: 'custom-app', op: 'readDir', args: { path: '.' }, id: 1,
    }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('/proj', 'custom-app', 'readDir', { path: '.' })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-response', id: 1, result: { files: [] } })
    })
  })

  it('handles miniapp-fs-request error', async () => {
    mockMiniapp.fsRequest.mockRejectedValue(new Error('denied'))
    handleMiniAppMessage('miniapp-fs-request', {
      op: 'readFile', args: { path: 'secret' }, id: 2,
    }, appId, projectDir, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-response', id: 2, error: 'denied' })
    })
  })

  it('handles miniapp-git-request and sends response', async () => {
    mockMiniapp.gitRequest.mockResolvedValue({ branch: 'main' })
    handleMiniAppMessage('miniapp-git-request', {
      op: 'info', args: {}, id: 3,
    }, appId, projectDir, send)
    expect(mockMiniapp.gitRequest).toHaveBeenCalledWith('/proj', 'test-app', 'info', {})
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-git-response', id: 3, result: { branch: 'main' } })
    })
  })

  it('handles miniapp-fs-watch and sends ack', async () => {
    mockMiniapp.fsWatch.mockResolvedValue(99)
    handleMiniAppMessage('miniapp-fs-watch', {
      path: 'src', id: 4,
    }, appId, projectDir, send)
    expect(mockMiniapp.fsWatch).toHaveBeenCalledWith('/proj', 'test-app', 'src')
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-watch-ack', id: 4, watchId: 99 })
    })
  })

  it('handles miniapp-fs-unwatch', () => {
    const result = handleMiniAppMessage('miniapp-fs-unwatch', { watchId: 7 }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsUnwatch).toHaveBeenCalledWith(7)
  })

  it('handles miniapp-open-folder', () => {
    const result = handleMiniAppMessage('miniapp-open-folder', { path: 'dist' }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('/proj', 'test-app', 'showInFolder', { path: 'dist' })
  })

  it('handles miniapp-open-folder ignores non-string path', () => {
    handleMiniAppMessage('miniapp-open-folder', { path: 123 }, appId, projectDir, send)
    expect(mockMiniapp.fsRequest).not.toHaveBeenCalled()
  })

  it('handles miniapp-open-external-link', () => {
    const spy = vi.spyOn(externalLink, 'requestOpenExternalLink').mockImplementation(() => {})
    const result = handleMiniAppMessage('miniapp-open-external-link', { url: 'https://example.com' }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(spy).toHaveBeenCalledWith('https://example.com')
    spy.mockRestore()
  })

  it('handles miniapp-open-external-link ignores non-string url', () => {
    const spy = vi.spyOn(externalLink, 'requestOpenExternalLink').mockImplementation(() => {})
    handleMiniAppMessage('miniapp-open-external-link', { url: 42 }, appId, projectDir, send)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-read and sends response', async () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardRead').mockResolvedValue('pasted')
    handleMiniAppMessage('miniapp-clipboard-read', { id: 5 }, appId, projectDir, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-clipboard-response', id: 5, text: 'pasted' })
    })
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-read error', async () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardRead').mockRejectedValue(new Error('denied'))
    handleMiniAppMessage('miniapp-clipboard-read', { id: 6 }, appId, projectDir, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-clipboard-response', id: 6, error: 'denied' })
    })
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-write', () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardWrite').mockImplementation(() => {})
    const result = handleMiniAppMessage('miniapp-clipboard-write', { text: 'copy this' }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(spy).toHaveBeenCalledWith('test-app', 'copy this')
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-write ignores non-string text', () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardWrite').mockImplementation(() => {})
    handleMiniAppMessage('miniapp-clipboard-write', { text: 123 }, appId, projectDir, send)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('uses data.appId over appId for fs-request when available', async () => {
    mockMiniapp.fsRequest.mockResolvedValue(null)
    handleMiniAppMessage('miniapp-fs-request', {
      appId: 'override-app', op: 'exists', args: { path: 'a' }, id: 10,
    }, appId, projectDir, send)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('/proj', 'override-app', 'exists', { path: 'a' })
  })

  it('falls back to appId for fs-request when data.appId is missing', async () => {
    mockMiniapp.fsRequest.mockResolvedValue(null)
    handleMiniAppMessage('miniapp-fs-request', {
      op: 'exists', args: { path: 'b' }, id: 11,
    }, appId, projectDir, send)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('/proj', 'test-app', 'exists', { path: 'b' })
  })

  it('handles miniapp-context-set with inject mode', () => {
    const result = handleMiniAppMessage('miniapp-context-set', {
      summary: '3 items', content: 'item1\nitem2\nitem3', mode: 'inject', color: '#4a7fbf',
    }, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', {
      appName: 'Test App',
      summary: '3 items',
      content: 'item1\nitem2\nitem3',
      mode: 'inject',
      color: '#4a7fbf',
    })
  })

  it('handles miniapp-context-set defaults mode to inject', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'data', content: 'abc',
    }, appId, projectDir, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ mode: 'inject' }))
  })

  it('handles miniapp-context-set with suggest mode', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'notes', content: 'some notes', mode: 'suggest',
    }, appId, projectDir, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ mode: 'suggest' }))
  })

  it('looks up app name from miniapp store', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'test', content: 'test',
    }, appId, projectDir, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ appName: 'Test App' }))
  })

  it('falls back to appId when app not found in store', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'test', content: 'test',
    }, 'unknown-app', projectDir, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('unknown-app', expect.objectContaining({ appName: 'unknown-app' }))
  })

  it('handles miniapp-context-clear', () => {
    const result = handleMiniAppMessage('miniapp-context-clear', {}, appId, projectDir, send)
    expect(result).toBe(true)
    expect(mockClearMiniAppContext).toHaveBeenCalledWith('test-app')
  })

  describe('media lifecycle', () => {
    it('routes miniapp-media-started with microphone to media store', () => {
      const result = handleMiniAppMessage('miniapp-media-started', { kinds: ['microphone'] }, appId, projectDir, send)
      expect(result).toBe(true)
      expect(mockMediaStart).toHaveBeenCalledWith('test-app', ['microphone'])
    })

    it('routes miniapp-media-started with both kinds', () => {
      handleMiniAppMessage('miniapp-media-started', { kinds: ['microphone', 'camera'] }, appId, projectDir, send)
      expect(mockMediaStart).toHaveBeenCalledWith('test-app', ['microphone', 'camera'])
    })

    it('filters out unknown kinds (e.g. screen)', () => {
      handleMiniAppMessage('miniapp-media-started', { kinds: ['microphone', 'screen', 'unknown'] }, appId, projectDir, send)
      expect(mockMediaStart).toHaveBeenCalledWith('test-app', ['microphone'])
    })

    it('drops empty kind arrays without calling start', () => {
      handleMiniAppMessage('miniapp-media-started', { kinds: ['screen'] }, appId, projectDir, send)
      expect(mockMediaStart).not.toHaveBeenCalled()
    })

    it('routes miniapp-media-track-ended for microphone', () => {
      handleMiniAppMessage('miniapp-media-track-ended', { kind: 'microphone' }, appId, projectDir, send)
      expect(mockMediaEndTrack).toHaveBeenCalledWith('test-app', 'microphone')
    })

    it('routes miniapp-media-track-ended for camera', () => {
      handleMiniAppMessage('miniapp-media-track-ended', { kind: 'camera' }, appId, projectDir, send)
      expect(mockMediaEndTrack).toHaveBeenCalledWith('test-app', 'camera')
    })

    it('ignores unknown track-ended kind', () => {
      handleMiniAppMessage('miniapp-media-track-ended', { kind: 'screen' }, appId, projectDir, send)
      expect(mockMediaEndTrack).not.toHaveBeenCalled()
    })
  })
})

describe('handleMiniAppWorkerMessage (headless policy)', () => {
  const appId = 'test-app'
  const projectDir = '/proj'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards a headless-safe data request (fs)', () => {
    const send = vi.fn()
    const handled = handleMiniAppWorkerMessage('miniapp-fs-request', { id: 1, op: 'readFile', args: {} }, appId, projectDir, send)
    expect(handled).toBe(true)
    expect(mockMiniapp.fsRequest).toHaveBeenCalled()
  })

  it('rejects a UI-bound type without invoking UI side effects', () => {
    const send = vi.fn()
    const handled = handleMiniAppWorkerMessage('miniapp-sendPrompt', { text: 'hi' }, appId, projectDir, send)
    expect(handled).toBe(true)
    expect(mockSetDraftText).not.toHaveBeenCalled()
  })

  it('replies unavailable-in-worker for a rejected request/response type', () => {
    const send = vi.fn()
    handleMiniAppWorkerMessage('miniapp-clipboard-read', { id: 7 }, appId, projectDir, send)
    expect(send).toHaveBeenCalledWith({ type: 'miniapp-clipboard-response', id: 7, error: 'unavailable-in-worker' })
  })

  it('returns false for unknown non-miniapp types', () => {
    const send = vi.fn()
    expect(handleMiniAppWorkerMessage('something-else', {}, appId, projectDir, send)).toBe(false)
  })
})
