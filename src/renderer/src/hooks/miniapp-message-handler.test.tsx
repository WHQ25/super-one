// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMiniAppMessage } from './miniapp-message-handler'
import * as externalLink from '@/lib/external-link'
import * as clipboardLib from '@/lib/miniapp-clipboard'

const mockMiniapp = {
  toolResult: vi.fn(),
  fsRequest: vi.fn(() => Promise.resolve('ok')),
  gitRequest: vi.fn(() => Promise.resolve('ok')),
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

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).miniapp = mockMiniapp
  ;(window as any).app = mockApp
})

describe('handleMiniAppMessage', () => {
  const appId = 'test-app'
  const send = vi.fn()

  it('returns false for unknown message types', () => {
    expect(handleMiniAppMessage('unknown-type', {}, appId, send)).toBe(false)
  })

  it('handles miniapp-tool-result', () => {
    const result = handleMiniAppMessage('miniapp-tool-result', {
      callId: 'c1', result: { ok: true }, error: undefined,
    }, appId, send)
    expect(result).toBe(true)
    expect(mockMiniapp.toolResult).toHaveBeenCalledWith('c1', { ok: true }, undefined)
  })

  it('handles miniapp-sendPrompt', () => {
    const result = handleMiniAppMessage('miniapp-sendPrompt', { text: 'hello' }, appId, send)
    expect(result).toBe(true)
    expect(mockSetDraftText).toHaveBeenCalledWith('hello')
  })

  it('handles miniapp-fs-request and sends response', async () => {
    mockMiniapp.fsRequest.mockResolvedValue({ files: [] })
    const result = handleMiniAppMessage('miniapp-fs-request', {
      appId: 'custom-app', op: 'readDir', args: { path: '.' }, id: 1,
    }, appId, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('custom-app', 'readDir', { path: '.' })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-response', id: 1, result: { files: [] } })
    })
  })

  it('handles miniapp-fs-request error', async () => {
    mockMiniapp.fsRequest.mockRejectedValue(new Error('denied'))
    handleMiniAppMessage('miniapp-fs-request', {
      op: 'readFile', args: { path: 'secret' }, id: 2,
    }, appId, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-response', id: 2, error: 'denied' })
    })
  })

  it('handles miniapp-git-request and sends response', async () => {
    mockMiniapp.gitRequest.mockResolvedValue({ branch: 'main' })
    handleMiniAppMessage('miniapp-git-request', {
      op: 'info', args: {}, id: 3,
    }, appId, send)
    expect(mockMiniapp.gitRequest).toHaveBeenCalledWith('test-app', 'info', {})
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-git-response', id: 3, result: { branch: 'main' } })
    })
  })

  it('handles miniapp-fs-watch and sends ack', async () => {
    mockMiniapp.fsWatch.mockResolvedValue(99)
    handleMiniAppMessage('miniapp-fs-watch', {
      path: 'src', id: 4,
    }, appId, send)
    expect(mockMiniapp.fsWatch).toHaveBeenCalledWith('test-app', 'src')
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-fs-watch-ack', id: 4, watchId: 99 })
    })
  })

  it('handles miniapp-fs-unwatch', () => {
    const result = handleMiniAppMessage('miniapp-fs-unwatch', { watchId: 7 }, appId, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsUnwatch).toHaveBeenCalledWith(7)
  })

  it('handles miniapp-open-folder', () => {
    const result = handleMiniAppMessage('miniapp-open-folder', { path: 'dist' }, appId, send)
    expect(result).toBe(true)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('test-app', 'showInFolder', { path: 'dist' })
  })

  it('handles miniapp-open-folder ignores non-string path', () => {
    handleMiniAppMessage('miniapp-open-folder', { path: 123 }, appId, send)
    expect(mockMiniapp.fsRequest).not.toHaveBeenCalled()
  })

  it('handles miniapp-open-external-link', () => {
    const spy = vi.spyOn(externalLink, 'requestOpenExternalLink').mockImplementation(() => {})
    const result = handleMiniAppMessage('miniapp-open-external-link', { url: 'https://example.com' }, appId, send)
    expect(result).toBe(true)
    expect(spy).toHaveBeenCalledWith('https://example.com')
    spy.mockRestore()
  })

  it('handles miniapp-open-external-link ignores non-string url', () => {
    const spy = vi.spyOn(externalLink, 'requestOpenExternalLink').mockImplementation(() => {})
    handleMiniAppMessage('miniapp-open-external-link', { url: 42 }, appId, send)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-read and sends response', async () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardRead').mockResolvedValue('pasted')
    handleMiniAppMessage('miniapp-clipboard-read', { id: 5 }, appId, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-clipboard-response', id: 5, text: 'pasted' })
    })
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-read error', async () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardRead').mockRejectedValue(new Error('denied'))
    handleMiniAppMessage('miniapp-clipboard-read', { id: 6 }, appId, send)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'miniapp-clipboard-response', id: 6, error: 'denied' })
    })
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-write', () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardWrite').mockImplementation(() => {})
    const result = handleMiniAppMessage('miniapp-clipboard-write', { text: 'copy this' }, appId, send)
    expect(result).toBe(true)
    expect(spy).toHaveBeenCalledWith('test-app', 'copy this')
    spy.mockRestore()
  })

  it('handles miniapp-clipboard-write ignores non-string text', () => {
    const spy = vi.spyOn(clipboardLib, 'requestClipboardWrite').mockImplementation(() => {})
    handleMiniAppMessage('miniapp-clipboard-write', { text: 123 }, appId, send)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('uses data.appId over appId for fs-request when available', async () => {
    mockMiniapp.fsRequest.mockResolvedValue(null)
    handleMiniAppMessage('miniapp-fs-request', {
      appId: 'override-app', op: 'exists', args: { path: 'a' }, id: 10,
    }, appId, send)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('override-app', 'exists', { path: 'a' })
  })

  it('falls back to appId for fs-request when data.appId is missing', async () => {
    mockMiniapp.fsRequest.mockResolvedValue(null)
    handleMiniAppMessage('miniapp-fs-request', {
      op: 'exists', args: { path: 'b' }, id: 11,
    }, appId, send)
    expect(mockMiniapp.fsRequest).toHaveBeenCalledWith('test-app', 'exists', { path: 'b' })
  })

  it('handles miniapp-context-set with inject mode', () => {
    const result = handleMiniAppMessage('miniapp-context-set', {
      summary: '3 items', content: 'item1\nitem2\nitem3', mode: 'inject', color: '#4a7fbf',
    }, appId, send)
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
    }, appId, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ mode: 'inject' }))
  })

  it('handles miniapp-context-set with suggest mode', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'notes', content: 'some notes', mode: 'suggest',
    }, appId, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ mode: 'suggest' }))
  })

  it('looks up app name from miniapp store', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'test', content: 'test',
    }, appId, send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('test-app', expect.objectContaining({ appName: 'Test App' }))
  })

  it('falls back to appId when app not found in store', () => {
    handleMiniAppMessage('miniapp-context-set', {
      summary: 'test', content: 'test',
    }, 'unknown-app', send)
    expect(mockSetMiniAppContext).toHaveBeenCalledWith('unknown-app', expect.objectContaining({ appName: 'unknown-app' }))
  })

  it('handles miniapp-context-clear', () => {
    const result = handleMiniAppMessage('miniapp-context-clear', {}, appId, send)
    expect(result).toBe(true)
    expect(mockClearMiniAppContext).toHaveBeenCalledWith('test-app')
  })
})
