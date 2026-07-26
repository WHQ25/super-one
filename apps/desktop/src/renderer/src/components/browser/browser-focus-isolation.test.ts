/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
