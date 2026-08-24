/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { HELPERS, runBrowserOp, useBrowserAutomationHost } from './browser-automation-runtime'
import { isBrowserFocusIsolationActive, _resetBrowserFocusIsolationForTests } from './browser-focus-isolation'
import { registerBrowserWebview } from './browser-host-api'
import { selectViewfinderTarget, useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'

interface Sone {
  selectorOf(el: Element): string | null
  dynamicToken(v: string): boolean
  stableSelector(el: Element): string | null
}

if (!(globalThis as { CSS?: unknown }).CSS) {
  ;(globalThis as { CSS?: unknown }).CSS = { escape: (v: string) => String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) }
}

function makeSone(): Sone {
  return new Function(HELPERS + '\nreturn __sone;')() as Sone
}

describe('selectorOf', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers a stable id', () => {
    document.body.innerHTML = '<button id="save">Save</button>'
    expect(makeSone().selectorOf(document.querySelector('#save')!)).toBe('#save')
  })

  it('skips framework-generated ids and falls back to a stable attribute', () => {
    document.body.innerHTML = '<button id="radix-:r3:" data-testid="submit">Go</button>'
    expect(makeSone().selectorOf(document.querySelector('[data-testid=submit]')!)).toBe('button[data-testid="submit"]')
  })

  it('drops CSS-in-JS hash classes from the path but keeps semantic ones', () => {
    document.body.innerHTML = '<section><div class="css-1a2b3c card"><span>x</span></div></section>'
    const sel = makeSone().selectorOf(document.querySelector('.card')!)!
    expect(sel).toContain('.card')
    expect(sel).not.toContain('css-1a2b3c')
  })

  it('uses a unique name attribute', () => {
    document.body.innerHTML = '<form><input name="email"><input name="password"></form>'
    expect(makeSone().selectorOf(document.querySelector('[name=email]')!)).toBe('input[name="email"]')
  })

  it('does not use a non-unique attribute', () => {
    document.body.innerHTML = '<div data-testid="row"></div><div data-testid="row"></div>'
    const sel = makeSone().selectorOf(document.querySelectorAll('[data-testid=row]')[0]!)!
    expect(sel).not.toContain('data-testid')
    expect(sel).toContain(':nth-of-type(1)')
  })
})

describe('dynamicToken', () => {
  it('flags generated tokens and spares stable ones', () => {
    const sone = makeSone()
    expect(sone.dynamicToken('css-1a2b3c')).toBe(true)
    expect(sone.dynamicToken('radix-:r3:')).toBe(true)
    expect(sone.dynamicToken('e1a2b3c4')).toBe(true)
    expect(sone.dynamicToken('a1b2c3d4e5f6')).toBe(true)
    expect(sone.dynamicToken('btn-primary')).toBe(false)
    expect(sone.dynamicToken('card')).toBe(false)
    expect(sone.dynamicToken('px-4')).toBe(false)
  })
})

describe('browser automation presentation activity', () => {
  it('marks the operated tab active for the duration of a browser call', async () => {
    useAgentViewfinderStore.setState({ activeBySession: {} })
    useBrowserStore.setState({
      tabs: {},
      automationCounts: {},
      activeAutomationId: null,
      pendingPreviewBrowserId: null,
      automationPreviewBrowserId: null,
    })
    useBrowserStore.getState().ensure('browser-a', 'https://example.com', 'session-a')
    const begin = vi.spyOn(useBrowserStore.getState(), 'beginAutomation')
    const end = vi.spyOn(useBrowserStore.getState(), 'endAutomation')

    await runBrowserOp('session-a', 'emulateViewport', {
      tab: 'browser-a',
      width: 390,
      height: 844,
    })

    expect(begin).toHaveBeenCalledWith('browser-a')
    expect(end).toHaveBeenCalledWith('browser-a')
    expect(useBrowserStore.getState().activeAutomationId).toBeNull()
    expect(useBrowserStore.getState().automationPreviewBrowserId).toBe('browser-a')
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'browser', targetId: 'browser-a' })
  })

  it('marks content injected into about:blank as visible guest content', async () => {
    useBrowserStore.setState({
      tabs: {},
      automationCounts: {},
      activeAutomationId: null,
      pendingPreviewBrowserId: null,
      automationPreviewBrowserId: null,
    })
    useBrowserStore.getState().ensure('browser-blank', 'about:blank', 'session-a')
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ installed: true })
      .mockResolvedValueOnce(true)
    const unregister = registerBrowserWebview('browser-blank', {
      executeJavaScript,
    } as unknown as Electron.WebviewTag)

    try {
      await runBrowserOp('session-a', 'evaluate', {
        tab: 'browser-blank',
        expression: 'document.body.innerHTML = "<button>Start</button>"',
      })

      expect(useBrowserStore.getState().tabs['browser-blank']?.hasCustomBlankContent).toBe(true)
      expect(executeJavaScript).toHaveBeenCalledTimes(2)
    } finally {
      unregister()
    }
  })
})

describe('automation host focus guard', () => {
  afterEach(() => {
    _resetBrowserFocusIsolationForTests()
    delete (window as { browserHost?: unknown }).browserHost
  })

  it('opens and closes host focus isolation for the main-process guard ops', async () => {
    let handler: ((req: { callId: string; sessionId: string; op: string; input: unknown }) => void) | null = null
    const sendAutomationResult = vi.fn()
    ;(window as { browserHost?: unknown }).browserHost = {
      onAutomationCall: (cb: typeof handler) => {
        handler = cb
        return () => {}
      },
      sendAutomationResult,
    }

    const { unmount } = renderHook(() => useBrowserAutomationHost())
    expect(handler).not.toBeNull()

    // CDP input runs in the main process, so it brackets its own dispatch with
    // these two calls instead of relying on a renderer op's isolation window.
    await handler!({ callId: 'c1', sessionId: 'session-a', op: 'focusGuardBegin', input: {} })
    expect(isBrowserFocusIsolationActive()).toBe(true)
    expect(sendAutomationResult).toHaveBeenCalledWith('c1', true, { ok: true })

    await handler!({ callId: 'c2', sessionId: 'session-a', op: 'focusGuardEnd', input: {} })
    expect(isBrowserFocusIsolationActive()).toBe(false)

    unmount()
  })
})
