/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginBrowserFocusIsolation,
  endBrowserFocusIsolation,
  isBrowserFocusIsolationActive,
  withBrowserFocusIsolation,
  _resetBrowserFocusIsolationForTests,
} from './browser-focus-isolation'

describe('browser focus isolation', () => {
  beforeEach(() => {
    _resetBrowserFocusIsolationForTests()
    document.body.innerHTML = `
      <textarea id="composer">hello</textarea>
      <div data-browser-host="">
        <div id="fake-webview" tabindex="0"></div>
      </div>
    `
    // jsdom has no real WEBVIEW tag; mark the stand-in so closest([data-browser-host]) matches.
    const wv = document.getElementById('fake-webview')!
    Object.defineProperty(wv, 'tagName', { value: 'WEBVIEW' })
  })

  afterEach(() => {
    _resetBrowserFocusIsolationForTests()
  })

  it('restores composer focus after automation if a webview steals it', async () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()
    composer.setSelectionRange(5, 5)

    await withBrowserFocusIsolation(async () => {
      wv.focus()
      expect(document.activeElement).toBe(composer)
    })

    expect(document.activeElement).toBe(composer)
    expect(composer.selectionStart).toBe(5)
    expect(composer.selectionEnd).toBe(5)
  })

  it('bounces focusin to the webview while isolation is active', () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()
    beginBrowserFocusIsolation()
    try {
      wv.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      // focusin handler restores; also call focus to simulate browser move
      wv.focus()
      expect(document.activeElement).toBe(composer)
    } finally {
      endBrowserFocusIsolation()
    }
  })

  it('ref-counts nested isolation so the outer region stays active', async () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()

    await withBrowserFocusIsolation(async () => {
      expect(isBrowserFocusIsolationActive()).toBe(true)
      await withBrowserFocusIsolation(async () => {
        wv.focus()
        expect(document.activeElement).toBe(composer)
      })
      expect(isBrowserFocusIsolationActive()).toBe(true)
      wv.focus()
      expect(document.activeElement).toBe(composer)
    })
    expect(isBrowserFocusIsolationActive()).toBe(false)
  })

  it('keeps bouncing for a grace period after the call resolves, covering late steals', async () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()
    vi.useFakeTimers()
    try {
      await withBrowserFocusIsolation(async () => {})

      // A CDP click dispatched from the main process (or a guest autofocus)
      // lands after the renderer op already returned.
      wv.focus()
      expect(document.activeElement).toBe(composer)

      vi.advanceTimersByTime(2000)
      wv.focus()
      expect(document.activeElement).toBe(wv)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-arms inside the grace period without losing the original snapshot', async () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()
    vi.useFakeTimers()
    try {
      await withBrowserFocusIsolation(async () => {})
      beginBrowserFocusIsolation()
      wv.focus()
      expect(document.activeElement).toBe(composer)
      endBrowserFocusIsolation()
      wv.focus()
      expect(document.activeElement).toBe(composer)
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-releases a guard whose end never arrives, so clicks into the page work again', () => {
    const composer = document.getElementById('composer') as HTMLTextAreaElement
    const wv = document.getElementById('fake-webview') as HTMLElement
    composer.focus()
    vi.useFakeTimers()
    try {
      // Main process opened the guard and then died / the window reloaded.
      beginBrowserFocusIsolation()
      vi.advanceTimersByTime(61_000)

      expect(isBrowserFocusIsolationActive()).toBe(false)
      wv.focus()
      expect(document.activeElement).toBe(wv)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not force-restore when the user was already focused inside the browser', async () => {
    const wv = document.getElementById('fake-webview') as HTMLElement
    wv.focus()
    expect(document.activeElement).toBe(wv)

    await withBrowserFocusIsolation(async () => {
      // No non-browser snapshot — leave guest-side focus alone.
      expect(document.activeElement).toBe(wv)
    })
    expect(document.activeElement).toBe(wv)
  })
})
