/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { toastFns, setDraftText, setMiniAppContext, clearMiniAppContext, openExternal, clipboardRead, clipboardWrite } =
  vi.hoisted(() => ({
    toastFns: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    setDraftText: vi.fn(),
    setMiniAppContext: vi.fn(),
    clearMiniAppContext: vi.fn(),
    openExternal: vi.fn(),
    clipboardRead: vi.fn(),
    clipboardWrite: vi.fn(),
  }))

vi.mock('sonner', () => ({ toast: toastFns }))
vi.mock('@/lib/external-link', () => ({ requestOpenExternalLink: openExternal }))
vi.mock('@/lib/miniapp-clipboard', () => ({
  requestClipboardRead: clipboardRead,
  requestClipboardWrite: clipboardWrite,
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      setDraftText,
      setMiniAppContext,
      clearMiniAppContext,
      projectSessions: { '/proj': { _activeSessionId: 's1' } },
    }),
  },
}))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: {
    getState: () => ({
      apps: [{ id: 'demo', manifest: { name: 'Demo App' } }],
      openApps: {
        k1: { entry: { id: 'demo' }, projectDir: '/proj', holderSessions: new Set(['s1']) },
      },
    }),
  },
}))

const { runMiniAppHostAction } = await import('./miniapp-host-actions')

describe('MiniApp Host actions in the renderer', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(toastFns), setDraftText, setMiniAppContext, clearMiniAppContext, openExternal, clipboardRead, clipboardWrite]) {
      fn.mockReset()
    }
    window.miniapp = { showItemInFolder: vi.fn() } as never
  })

  it('routes a prompt to the session that holds the mini-app, not the visible one', async () => {
    await runMiniAppHostAction('demo', '/proj', 'agent.sendPrompt', { text: 'hi' })

    expect(setDraftText).toHaveBeenCalledWith('hi', { projectPath: '/proj', sessionId: 's1' })
  })

  it('fills the context card with the app name from its manifest', async () => {
    await runMiniAppHostAction('demo', '/proj', 'agent.setContext', {
      summary: 's', content: 'c', mode: 'suggest', color: '#fff',
    })

    expect(setMiniAppContext).toHaveBeenCalledWith(
      'demo',
      { appName: 'Demo App', summary: 's', content: 'c', mode: 'suggest', color: '#fff' },
      { projectPath: '/proj', sessionId: 's1' },
    )
  })

  it('clears the context card', async () => {
    await runMiniAppHostAction('demo', '/proj', 'agent.clearContext', {})
    expect(clearMiniAppContext).toHaveBeenCalledWith('demo', { projectPath: '/proj', sessionId: 's1' })
  })

  it('dispatches each toast type, defaulting to info', async () => {
    await runMiniAppHostAction('demo', '/proj', 'host.toast', { message: 'ok', toastType: 'success' })
    expect(toastFns.success).toHaveBeenCalledWith('ok')

    await runMiniAppHostAction('demo', '/proj', 'host.toast', { message: 'plain' })
    expect(toastFns.info).toHaveBeenCalledWith('plain')
  })

  it('keeps the consent prompts by going through the existing request helpers', async () => {
    clipboardRead.mockResolvedValue('pasted')
    expect(await runMiniAppHostAction('demo', '/proj', 'host.clipboard.read', {})).toBe('pasted')
    expect(clipboardRead).toHaveBeenCalledWith('demo')

    await runMiniAppHostAction('demo', '/proj', 'host.openExternal', { url: 'https://x.com' })
    expect(openExternal).toHaveBeenCalledWith('https://x.com')
  })

  it('propagates a denied clipboard read as a rejection', async () => {
    clipboardRead.mockRejectedValue(new Error('Clipboard read denied by user'))
    await expect(runMiniAppHostAction('demo', '/proj', 'host.clipboard.read', {})).rejects.toThrow(/denied/)
  })

  it('rejects a bad payload instead of passing it on', async () => {
    await expect(runMiniAppHostAction('demo', '/proj', 'agent.sendPrompt', { text: 42 })).rejects.toThrow(/must be a string/)
    await expect(runMiniAppHostAction('demo', '/proj', 'host.revealInFolder', {})).rejects.toThrow(/must be a string/)
    await expect(runMiniAppHostAction('demo', '/proj', 'nope', {})).rejects.toThrow(/Unknown host action/)
  })
})
