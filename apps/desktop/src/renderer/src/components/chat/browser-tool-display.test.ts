import { describe, it, expect } from 'vitest'
import { getBrowserOp, browserVerbKey, isReadBrowserOp, browserInputSummary, parseBrowserResult } from './browser-tool-display'

describe('getBrowserOp', () => {
  it('strips the browser_ prefix for known ops', () => {
    expect(getBrowserOp('browser_click')).toBe('click')
    expect(getBrowserOp('browser_wait_for')).toBe('wait_for')
  })

  it('recognizes the CDP-only ops', () => {
    expect(getBrowserOp('browser_network')).toBe('network')
    expect(getBrowserOp('browser_network_wait')).toBe('network_wait')
    expect(getBrowserOp('browser_network_body')).toBe('network_body')
    expect(getBrowserOp('browser_cookies')).toBe('cookies')
    expect(getBrowserOp('browser_upload_file')).toBe('upload_file')
    expect(getBrowserOp('browser_emulate')).toBe('emulate')
    expect(getBrowserOp('browser_mock')).toBe('mock')
  })

  it('returns null for non-browser superone tools and unknown ops', () => {
    expect(getBrowserOp('widget_show')).toBeNull()
    expect(getBrowserOp('miniapp_dev_setup')).toBeNull()
    expect(getBrowserOp('browser_teleport')).toBeNull()
  })
})

describe('browserVerbKey', () => {
  it('camelCases wait_for and upload_file and leaves others intact', () => {
    expect(browserVerbKey('wait_for')).toBe('waitFor')
    expect(browserVerbKey('upload_file')).toBe('uploadFile')
    expect(browserVerbKey('network_wait')).toBe('networkWait')
    expect(browserVerbKey('network_body')).toBe('networkBody')
    expect(browserVerbKey('snapshot')).toBe('snapshot')
  })
})

describe('isReadBrowserOp', () => {
  it('marks inspection ops as read-only and actions as not', () => {
    expect(isReadBrowserOp('snapshot')).toBe(true)
    expect(isReadBrowserOp('evaluate')).toBe(true)
    expect(isReadBrowserOp('network')).toBe(true)
    expect(isReadBrowserOp('network_wait')).toBe(true)
    expect(isReadBrowserOp('network_body')).toBe(true)
    expect(isReadBrowserOp('cookies')).toBe(true)
    expect(isReadBrowserOp('click')).toBe(false)
    expect(isReadBrowserOp('emulate')).toBe(false)
  })
})

describe('browserInputSummary', () => {
  it('summarizes navigation by url, port, or history action', () => {
    expect(browserInputSummary('navigate', { url: 'https://example.com/login' })).toBe('example.com/login')
    expect(browserInputSummary('navigate', { port: 3000, path: '/settings' })).toBe('localhost:3000/settings')
    expect(browserInputSummary('navigate', { action: 'back' })).toBe('back')
  })

  it('summarizes clicks by selector, text, or coordinates', () => {
    expect(browserInputSummary('click', { selector: '#submit' })).toBe('#submit')
    expect(browserInputSummary('click', { text: 'Log in' })).toBe('“Log in”')
    expect(browserInputSummary('click', { x: 10, y: 20 })).toBe('(10, 20)')
  })

  it('shows the target and truncated text for typing', () => {
    expect(browserInputSummary('type', { selector: '#email', text: 'hi@a.com' })).toBe('#email ← hi@a.com')
  })

  it('masks secret input by field name or high-entropy value, but leaves ordinary text alone', () => {
    expect(browserInputSummary('type', { selector: '#password', text: 'hunter2' })).toBe('#password ← ••••••')
    expect(browserInputSummary('type', { selector: 'input[name="apiKey"]', text: 'x' })).toBe('input[name="apiKey"] ← ••••••')
    expect(browserInputSummary('type', { text: 'A1b2C3d4E5f6G7h8xy' })).toBe('••••••')
    expect(browserInputSummary('type', { selector: '#search', text: 'hello world' })).toBe('#search ← hello world')
    expect(browserInputSummary('type', { selector: '#spinner-name', text: 'Ada' })).toBe('#spinner-name ← Ada')
  })

  it('joins modifiers for key presses', () => {
    expect(browserInputSummary('press', { key: 'a', modifiers: ['Meta'] })).toBe('Meta+a')
    expect(browserInputSummary('press', { key: 'Enter' })).toBe('Enter')
  })

  it('joins query and wait_for conditions', () => {
    expect(browserInputSummary('query', { role: 'button', text: 'Save' })).toBe('button · “Save”')
    expect(browserInputSummary('wait_for', { selectorGone: '.spinner', urlIncludes: '/done' })).toBe('!.spinner · url:/done')
  })

  it('returns empty for tabs', () => {
    expect(browserInputSummary('tabs', {})).toBe('')
  })

  it('summarizes network by body, wait, or filters', () => {
    expect(browserInputSummary('network', { bodyForUrl: '/api/user' })).toBe('body: /api/user')
    expect(browserInputSummary('network', { waitForUrl: '/search' })).toBe('wait: /search')
    expect(browserInputSummary('network', { method: 'POST', statusMin: 400 })).toBe('POST · 400–')
  })

  it('summarizes network_wait and network_body by url substring', () => {
    expect(browserInputSummary('network_wait', { url: '/search' })).toBe('/search')
    expect(browserInputSummary('network_body', { url: '/api/user' })).toBe('/api/user')
  })

  it('summarizes emulate by dimensions or reset, and mock by url or clear', () => {
    expect(browserInputSummary('emulate', { width: 390, height: 844, mobile: true })).toBe('390×844 · mobile')
    expect(browserInputSummary('emulate', { reset: true })).toBe('reset')
    expect(browserInputSummary('mock', { url: '/json' })).toBe('/json')
    expect(browserInputSummary('mock', { clear: true })).toBe('clear')
  })

  it('summarizes upload_file by selector and file count', () => {
    expect(browserInputSummary('upload_file', { selector: '#file', files: ['/a', '/b'] })).toBe('#file ← 2')
  })

  it('summarizes drag as source → destination across targeting modes', () => {
    expect(browserInputSummary('drag', { from: { selector: '#a' }, to: { selector: '#b' } })).toBe('#a → #b')
    expect(browserInputSummary('drag', { from: { text: 'Card' }, to: { x: 10, y: 20 } })).toBe('“Card” → (10, 20)')
    expect(browserInputSummary('drag', { from: {}, to: { selector: '#b' } })).toBe('? → #b')
  })
})

describe('parseBrowserResult', () => {
  it('reports error when the tool result is flagged as an error', () => {
    const info = parseBrowserResult('click', '[Error] element not found', true)
    expect(info.status).toBe('error')
    expect(info.errorText).toBe('element not found')
  })

  it('reports error when ok is false', () => {
    const info = parseBrowserResult('click', JSON.stringify({ ok: false, error: 'not visible' }), false)
    expect(info.status).toBe('error')
    expect(info.errorText).toBe('not visible')
  })

  it('marks action ops ok on success', () => {
    expect(parseBrowserResult('click', JSON.stringify({ ok: true }), false).status).toBe('ok')
    expect(parseBrowserResult('navigate', JSON.stringify({ url: 'https://x.com' }), false).status).toBe('ok')
  })

  it('counts matches and tabs for read ops but not snapshot', () => {
    expect(parseBrowserResult('snapshot', JSON.stringify({ elements: [1, 2, 3] }), false).count).toBeUndefined()
    expect(parseBrowserResult('query', JSON.stringify({ matches: [1], total: 7 }), false).count).toEqual({ kind: 'matches', n: 7 })
    expect(parseBrowserResult('tabs', JSON.stringify([1, 2]), false).count).toEqual({ kind: 'tabs', n: 2 })
  })

  it('extracts the saved path for a screenshot and marks it ok', () => {
    const info = parseBrowserResult('screenshot', JSON.stringify({ path: '/tmp/shot.png', width: 800, height: 600 }), false)
    expect(info.status).toBe('ok')
    expect(info.imagePath).toBe('/tmp/shot.png')
  })

  it('counts network requests and cookies, and marks CDP actions ok', () => {
    expect(parseBrowserResult('network', JSON.stringify({ requests: [1, 2, 3] }), false).count).toEqual({ kind: 'requests', n: 3 })
    expect(parseBrowserResult('network', JSON.stringify('a body string'), false).count).toBeUndefined()
    expect(parseBrowserResult('cookies', JSON.stringify({ cookies: [1, 2] }), false).count).toEqual({ kind: 'cookies', n: 2 })
    expect(parseBrowserResult('emulate', JSON.stringify({ ok: true, reset: false }), false).status).toBe('ok')
    expect(parseBrowserResult('mock', JSON.stringify({ ok: true, mocking: '/json' }), false).status).toBe('ok')
  })

  it('flags a missing element for inspect', () => {
    expect(parseBrowserResult('inspect', JSON.stringify({ exists: false }), false).notFound).toBe(true)
    expect(parseBrowserResult('inspect', JSON.stringify({ exists: true, tag: 'div' }), false).notFound).toBeUndefined()
  })

  it('stays neutral when the result is missing or unparseable', () => {
    expect(parseBrowserResult('snapshot', undefined, false).status).toBe('neutral')
    expect(parseBrowserResult('evaluate', 'not json', false).status).toBe('neutral')
  })
})
