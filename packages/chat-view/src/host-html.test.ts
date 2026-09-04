import { describe, expect, it } from 'vitest'
import { CHAT_VIEW_HTML } from './host-html'
import { TERMINAL_VIEW_HTML } from './terminal-html'

describe('embedded chat document', () => {
  it('contains the production renderer and its boot marker', () => {
    expect(CHAT_VIEW_HTML).toContain('<div id="root"></div>')
    expect(CHAT_VIEW_HTML).toContain('chatViewReady')
    expect(CHAT_VIEW_HTML).toContain('--brand-hue')
  })

  it('has no build-time asset references or unresolved Vite placeholders', () => {
    expect(CHAT_VIEW_HTML).not.toMatch(/(?:src|href)=["']\.\/assets\//)
    expect(CHAT_VIEW_HTML).not.toContain('__VITE_PRELOAD__')
  })
})

describe('embedded terminal document', () => {
  it('contains xterm and the bidirectional native bridge', () => {
    expect(TERMINAL_VIEW_HTML).toContain('xterm')
    expect(TERMINAL_VIEW_HTML).toContain('terminalReady')
    expect(TERMINAL_VIEW_HTML).toContain('terminalInput')
    expect(TERMINAL_VIEW_HTML).toContain('terminalResize')
    expect(TERMINAL_VIEW_HTML).toContain('__applyHost')
    expect(TERMINAL_VIEW_HTML).toContain('setTheme')
    expect(TERMINAL_VIEW_HTML).toContain('--terminal-background')
  })

  it('is self-contained', () => {
    expect(TERMINAL_VIEW_HTML.length).toBeGreaterThan(100_000)
    expect(TERMINAL_VIEW_HTML).not.toMatch(/(?:src|href)=["']\.\/assets\//)
    expect(TERMINAL_VIEW_HTML).not.toContain('__VITE_PRELOAD__')
  })
})
