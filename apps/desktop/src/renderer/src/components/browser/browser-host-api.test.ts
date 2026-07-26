import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearBrowserConsole,
  focusBrowserWebview,
  pushBrowserConsole,
  readBrowserConsole,
  registerBrowserWebview,
} from './browser-host-api'

const ID = 'test-tab'

function seed(): void {
  clearBrowserConsole(ID)
  pushBrowserConsole(ID, 'log', 'plain log line')
  pushBrowserConsole(ID, 'info', 'info about Widget')
  pushBrowserConsole(ID, 'warning', 'deprecation warning')
  pushBrowserConsole(ID, 'error', 'Uncaught TypeError: boom')
  pushBrowserConsole(ID, 'error', 'network ERROR 500')
}

describe('readBrowserConsole filtering', () => {
  beforeEach(seed)

  it('defaults to warning+error levels when no level is given', () => {
    const out = readBrowserConsole(ID, {})
    expect(out.map((e) => e.level)).toEqual(['warning', 'error', 'error'])
  })

  it('filters to an explicit level set', () => {
    const out = readBrowserConsole(ID, { level: ['error'] })
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.level === 'error')).toBe(true)
  })

  it('greps by case-insensitive substring by default across all requested levels', () => {
    const out = readBrowserConsole(ID, { level: ['log', 'info', 'warning', 'error'], grep: 'error' })
    expect(out.map((e) => e.text)).toEqual(['Uncaught TypeError: boom', 'network ERROR 500'])
  })

  it('honours case-sensitive grep when ignoreCase is false', () => {
    const out = readBrowserConsole(ID, { level: ['log', 'info', 'warning', 'error'], grep: 'ERROR', ignoreCase: false })
    expect(out.map((e) => e.text)).toEqual(['network ERROR 500'])
  })

  it('supports regex grep', () => {
    const out = readBrowserConsole(ID, { level: ['log', 'info', 'warning', 'error'], grep: '\\b\\d{3}\\b', regex: true })
    expect(out.map((e) => e.text)).toEqual(['network ERROR 500'])
  })

  it('inverts the grep match like grep -v', () => {
    const out = readBrowserConsole(ID, { level: ['error'], grep: 'network', invert: true })
    expect(out.map((e) => e.text)).toEqual(['Uncaught TypeError: boom'])
  })

  it('returns the most recent N entries after filtering', () => {
    const out = readBrowserConsole(ID, { level: ['log', 'info', 'warning', 'error'], max: 2 })
    expect(out.map((e) => e.text)).toEqual(['Uncaught TypeError: boom', 'network ERROR 500'])
  })

  it('throws a clear error on an invalid regex', () => {
    expect(() => readBrowserConsole(ID, { grep: '(', regex: true })).toThrow(/Invalid console grep regex/)
  })
})

describe('focusBrowserWebview', () => {
  it('never calls focus on the webview host element (agent must not steal caret)', () => {
    const el = { focus: vi.fn() } as unknown as Electron.WebviewTag
    const unregister = registerBrowserWebview('tab-1', el)
    expect(focusBrowserWebview('tab-1')).toBe(true)
    expect(el.focus).not.toHaveBeenCalled()
    expect(focusBrowserWebview('missing')).toBe(false)
    unregister()
  })
})
