// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routeCloseTabShortcut } from './close-tab-router'

describe('⌘W close-tab routing by focused region', () => {
  const handlers = {
    closeTerminal: vi.fn(),
    closeDock: vi.fn(),
    closeWindow: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('closes the terminal tab when focus is inside the xterm surface', () => {
    document.body.innerHTML = `<div class="xterm"><textarea id="t"></textarea></div>`
    const el = document.getElementById('t')!

    expect(routeCloseTabShortcut(el, handlers)).toBe('terminal')
    expect(handlers.closeTerminal).toHaveBeenCalledOnce()
    expect(handlers.closeDock).not.toHaveBeenCalled()
    expect(handlers.closeWindow).not.toHaveBeenCalled()
  })

  it('closes the active dockview panel when focus is inside a panel mini-app iframe (the reported regression)', () => {
    // The mini-app iframe is portaled into the fixed host layer, NOT nested
    // inside [data-activity-outer]. Only the panel-presentation marker links
    // it back to its dock tab.
    document.body.innerHTML = `
      <div data-activity-outer=""></div>
      <div data-miniapp-host-layer="">
        <div data-miniapp-host="" data-miniapp-presentation="panel"><iframe id="mini"></iframe></div>
      </div>`
    const iframe = document.getElementById('mini')!

    expect(routeCloseTabShortcut(iframe, handlers)).toBe('dock')
    expect(handlers.closeDock).toHaveBeenCalledOnce()
    expect(handlers.closeTerminal).not.toHaveBeenCalled()
    expect(handlers.closeWindow).not.toHaveBeenCalled()
  })

  it('closes the window when focus is inside a canvas mini-app (no dock tab to close)', () => {
    document.body.innerHTML = `
      <div data-miniapp-host-layer="">
        <div data-miniapp-host="" data-miniapp-presentation="canvas"><iframe id="mini"></iframe></div>
      </div>`
    const iframe = document.getElementById('mini')!

    expect(routeCloseTabShortcut(iframe, handlers)).toBe('window')
    expect(handlers.closeWindow).toHaveBeenCalledOnce()
    expect(handlers.closeDock).not.toHaveBeenCalled()
  })

  it('closes the window when focus is outside both the terminal and the activity panel', () => {
    document.body.innerHTML = `<textarea id="chat"></textarea>`
    const chat = document.getElementById('chat')!

    expect(routeCloseTabShortcut(chat, handlers)).toBe('window')
    expect(handlers.closeWindow).toHaveBeenCalledOnce()
    expect(handlers.closeTerminal).not.toHaveBeenCalled()
    expect(handlers.closeDock).not.toHaveBeenCalled()
  })

  it('closes the window when there is no focused element', () => {
    expect(routeCloseTabShortcut(null, handlers)).toBe('window')
    expect(handlers.closeWindow).toHaveBeenCalledOnce()
  })

  it('prefers the terminal over the activity panel when an xterm is nested inside it', () => {
    document.body.innerHTML = `<div data-activity-outer=""><div class="xterm"><span id="x"></span></div></div>`
    const x = document.getElementById('x')!

    expect(routeCloseTabShortcut(x, handlers)).toBe('terminal')
    expect(handlers.closeTerminal).toHaveBeenCalledOnce()
    expect(handlers.closeDock).not.toHaveBeenCalled()
  })
})
