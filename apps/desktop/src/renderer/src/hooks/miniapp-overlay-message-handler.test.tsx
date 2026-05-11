// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMiniAppMessage, type MiniAppOverlayCallbacks } from './miniapp-message-handler'

vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  })
  return { toast }
})

vi.mock('@/stores/chat', () => ({
  useChatStore: { getState: () => ({ setDraftText: vi.fn() }) },
}))

import { toast } from 'sonner'

const mockMiniapp = {
  toolResult: vi.fn(),
  fsRequest: vi.fn(() => Promise.resolve()),
  gitRequest: vi.fn(() => Promise.resolve()),
  fsWatch: vi.fn(() => Promise.resolve(1)),
  fsUnwatch: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).miniapp = mockMiniapp
})

describe('miniapp-ui-toast', () => {
  const send = vi.fn()

  it('calls toast.success for success type', () => {
    const result = handleMiniAppMessage('miniapp-ui-toast', {
      message: 'Done!', toastType: 'success',
    }, 'app1', '/proj', send)
    expect(result).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Done!')
  })

  it('calls toast.error for error type', () => {
    handleMiniAppMessage('miniapp-ui-toast', {
      message: 'Failed', toastType: 'error',
    }, 'app1', '/proj', send)
    expect(toast.error).toHaveBeenCalledWith('Failed')
  })

  it('calls toast.warning for warning type', () => {
    handleMiniAppMessage('miniapp-ui-toast', {
      message: 'Careful', toastType: 'warning',
    }, 'app1', '/proj', send)
    expect(toast.warning).toHaveBeenCalledWith('Careful')
  })

  it('calls toast.info for info type', () => {
    handleMiniAppMessage('miniapp-ui-toast', {
      message: 'FYI', toastType: 'info',
    }, 'app1', '/proj', send)
    expect(toast.info).toHaveBeenCalledWith('FYI')
  })

  it('defaults to toast.info for unknown type', () => {
    handleMiniAppMessage('miniapp-ui-toast', {
      message: 'Hello', toastType: 'unknown',
    }, 'app1', '/proj', send)
    expect(toast.info).toHaveBeenCalledWith('Hello')
  })
})

describe('miniapp-ui-tooltip', () => {
  const send = vi.fn()

  it('calls onTooltip with request data for tooltip-show', () => {
    const overlay: MiniAppOverlayCallbacks = { onTooltip: vi.fn() }
    const anchorRect = { x: 10, y: 20, width: 100, height: 30 }
    const result = handleMiniAppMessage('miniapp-ui-tooltip-show', {
      anchorRect, text: 'Tip', side: 'bottom',
    }, 'app1', '/proj', send, overlay)
    expect(result).toBe(true)
    expect(overlay.onTooltip).toHaveBeenCalledWith({
      anchorRect, text: 'Tip', side: 'bottom',
    })
  })

  it('calls onTooltip with null for tooltip-hide', () => {
    const overlay: MiniAppOverlayCallbacks = { onTooltip: vi.fn() }
    const result = handleMiniAppMessage('miniapp-ui-tooltip-hide', {}, 'app1', '/proj', send, overlay)
    expect(result).toBe(true)
    expect(overlay.onTooltip).toHaveBeenCalledWith(null)
  })

  it('returns true even without overlay callbacks', () => {
    expect(handleMiniAppMessage('miniapp-ui-tooltip-show', {
      anchorRect: { x: 0, y: 0, width: 0, height: 0 }, text: 'x',
    }, 'app1', '/proj', send)).toBe(true)
    expect(handleMiniAppMessage('miniapp-ui-tooltip-hide', {}, 'app1', '/proj', send)).toBe(true)
  })
})

describe('miniapp-ui-contextmenu', () => {
  const send = vi.fn()

  it('calls onContextMenu and sends result when respond is called', () => {
    const overlay: MiniAppOverlayCallbacks = {
      onContextMenu: vi.fn((_req, respond) => { respond('edit') }),
    }
    const items = [{ id: 'edit', label: 'Edit' }]
    const result = handleMiniAppMessage('miniapp-ui-contextmenu', {
      id: 42, position: { x: 100, y: 200 }, items,
    }, 'app1', '/proj', send, overlay)
    expect(result).toBe(true)
    expect(overlay.onContextMenu).toHaveBeenCalledWith(
      { position: { x: 100, y: 200 }, items },
      expect.any(Function),
    )
    expect(send).toHaveBeenCalledWith({
      type: 'miniapp-ui-contextmenu-result', id: 42, itemId: 'edit',
    })
  })

  it('sends null itemId when dismissed', () => {
    const overlay: MiniAppOverlayCallbacks = {
      onContextMenu: vi.fn((_req, respond) => { respond(null) }),
    }
    handleMiniAppMessage('miniapp-ui-contextmenu', {
      id: 7, position: { x: 0, y: 0 }, items: [],
    }, 'app1', '/proj', send, overlay)
    expect(send).toHaveBeenCalledWith({
      type: 'miniapp-ui-contextmenu-result', id: 7, itemId: null,
    })
  })

  it('sends null immediately when no overlay callback', () => {
    handleMiniAppMessage('miniapp-ui-contextmenu', {
      id: 99, position: { x: 0, y: 0 }, items: [],
    }, 'app1', '/proj', send)
    expect(send).toHaveBeenCalledWith({
      type: 'miniapp-ui-contextmenu-result', id: 99, itemId: null,
    })
  })
})
