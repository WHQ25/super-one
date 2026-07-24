import { describe, expect, it, vi } from 'vitest'
import { createTerminalKeyEventHandler, getTerminalFindDirection } from './terminal-keybindings'

const keyEvent = (
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'type'>> = {},
): KeyboardEvent =>
  ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    type: 'keydown',
    key,
    preventDefault: vi.fn(),
    ...modifiers,
  }) as unknown as KeyboardEvent

function setup(overrides: Partial<Parameters<typeof createTerminalKeyEventHandler>[0]> = {}) {
  const actions = {
    clearSelection: vi.fn(),
    closeFind: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    hasSelection: vi.fn(() => false),
    isFindVisible: vi.fn(() => false),
    openFind: vi.fn(),
    sendInput: vi.fn(),
    ...overrides,
  }
  return { actions, handle: createTerminalKeyEventHandler(actions) }
}

describe('macOS terminal keyboard shortcuts', () => {
  it.each(['c', 'v', 'a'])(
    'leaves Cmd+%s to xterm so native clipboard and selection behavior remains available',
    (key) => {
      const { actions, handle } = setup()

      expect(handle(keyEvent(key, { metaKey: true }))).toBe(true)
      expect(actions.sendInput).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['ArrowLeft', '\x01'],
    ['ArrowRight', '\x05'],
  ])('sends the shell control sequence for Cmd+%s', (key, sequence) => {
    const { actions, handle } = setup()

    expect(handle(keyEvent(key, { metaKey: true }))).toBe(false)
    expect(actions.sendInput).toHaveBeenCalledWith(sequence)
  })

  it('sends Ctrl+U for Cmd+Backspace to delete to the start of the shell input', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('Backspace', { metaKey: true }))).toBe(false)
    expect(actions.sendInput).toHaveBeenCalledWith('\x15')
  })

  it('sends Ctrl+W for Option+Backspace to delete the previous shell word', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('Backspace', { altKey: true }))).toBe(false)
    expect(actions.sendInput).toHaveBeenCalledWith('\x17')
  })

  it.each(['ArrowLeft', 'ArrowRight'])(
    'leaves Option+%s to xterm so its macOS word movement sequence is preserved',
    (key) => {
      const { actions, handle } = setup()

      expect(handle(keyEvent(key, { altKey: true }))).toBe(true)
      expect(actions.sendInput).not.toHaveBeenCalled()
    },
  )

  it('opens terminal find with Cmd+F', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('f', { metaKey: true }))).toBe(false)
    expect(actions.openFind).toHaveBeenCalledOnce()
  })

  it('preserves the existing close-tab interception for Cmd+W', () => {
    const { handle } = setup()

    expect(handle(keyEvent('w', { metaKey: true }))).toBe(false)
    expect(handle(keyEvent('w', { ctrlKey: true }))).toBe(true)
  })

  it('optionally preserves Ctrl+W interception for activity terminals', () => {
    const { actions } = setup()
    const handle = createTerminalKeyEventHandler(actions, { interceptCtrlW: true })

    expect(handle(keyEvent('w', { ctrlKey: true }))).toBe(false)
  })

  it('moves between terminal find results with Cmd+G and Cmd+Shift+G', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('g', { metaKey: true }))).toBe(false)
    expect(handle(keyEvent('g', { metaKey: true, shiftKey: true }))).toBe(false)
    expect(actions.findNext).toHaveBeenCalledOnce()
    expect(actions.findPrevious).toHaveBeenCalledOnce()
  })

  it('closes find before clearing the terminal selection on Escape', () => {
    const { actions, handle } = setup({
      hasSelection: vi.fn(() => true),
      isFindVisible: vi.fn(() => true),
    })

    expect(handle(keyEvent('Escape'))).toBe(false)
    expect(actions.closeFind).toHaveBeenCalledOnce()
    expect(actions.clearSelection).not.toHaveBeenCalled()
  })

  it('clears the terminal selection on Escape when find is closed', () => {
    const { actions, handle } = setup({ hasSelection: vi.fn(() => true) })

    expect(handle(keyEvent('Escape'))).toBe(false)
    expect(actions.clearSelection).toHaveBeenCalledOnce()
  })

  it('leaves Escape to the shell when there is no find or selection to dismiss', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('Escape'))).toBe(true)
  })

  it('ignores keyup events so a handled shortcut only runs once', () => {
    const { actions, handle } = setup()

    expect(handle(keyEvent('ArrowLeft', { metaKey: true, type: 'keyup' }))).toBe(true)
    expect(actions.sendInput).not.toHaveBeenCalled()
  })
})

describe('terminal find input shortcuts', () => {
  it.each([
    [keyEvent('Enter'), 'next'],
    [keyEvent('Enter', { shiftKey: true }), 'previous'],
    [keyEvent('g', { metaKey: true }), 'next'],
    [keyEvent('g', { metaKey: true, shiftKey: true }), 'previous'],
  ] as const)('resolves supported find navigation keys', (event, direction) => {
    expect(getTerminalFindDirection(event, true)).toBe(direction)
  })

  it('does not treat Enter as a terminal-level find shortcut', () => {
    expect(getTerminalFindDirection(keyEvent('Enter'))).toBeUndefined()
  })
})
