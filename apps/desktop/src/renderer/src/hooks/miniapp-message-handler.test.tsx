// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMiniAppMessage } from './miniapp-message-handler'
import * as externalLink from '@/lib/external-link'
import * as clipboardLib from '@/lib/miniapp-clipboard'

const mockMiniapp = {
  showItemInFolder: vi.fn(),
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
      projectSessions: {},
    }),
  },
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: {
    getState: () => ({
      apps: [{ id: 'test-app', manifest: { name: 'Test App' } }],
      openApps: {},
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

  it('no longer handles the capabilities that moved to the MiniApp Host', () => {
    for (const type of [
      'miniapp-sendPrompt', 'miniapp-context-set', 'miniapp-context-clear',
      'miniapp-open-folder', 'miniapp-open-external-link',
      'miniapp-clipboard-read', 'miniapp-clipboard-write', 'miniapp-ui-toast',
    ]) {
      expect(handleMiniAppMessage(type, {}, appId, projectDir, send)).toBe(false)
    }
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
