/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionContextMenuZone } from './SelectionContextMenu'

const addUserSelection = vi.fn()
vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { addUserSelection: typeof addUserSelection }) => unknown) =>
    selector({ addUserSelection }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.selectionMenu.copy': '复制',
        'chat.selectionMenu.addToChat': '添加到聊天',
      }
      return map[key] ?? key
    },
  }),
}))

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

function mockSelection(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: text ? 1 : 0,
    toString: () => text,
  } as unknown as Selection)
}

describe('SelectionContextMenuZone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    addUserSelection.mockClear()
  })

  it('does not render any menu by default', () => {
    render(
      <SelectionContextMenuZone>
        <p>some content</p>
      </SelectionContextMenuZone>,
    )
    expect(screen.queryByText('复制')).toBeNull()
    expect(screen.queryByText('添加到聊天')).toBeNull()
  })

  it('opens 复制 / 添加到聊天 on right-click with a non-empty selection', () => {
    render(
      <SelectionContextMenuZone>
        <p>hello world</p>
      </SelectionContextMenuZone>,
    )

    mockSelection('hello')
    fireEvent.contextMenu(screen.getByText('hello world'), { clientX: 100, clientY: 200 })

    expect(screen.getByText('复制')).toBeTruthy()
    expect(screen.getByText('添加到聊天')).toBeTruthy()
  })

  it('does not open the menu when no text is selected, and suppresses the browser default', () => {
    render(
      <SelectionContextMenuZone>
        <p>hello world</p>
      </SelectionContextMenuZone>,
    )

    mockSelection('')
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
    screen.getByText('hello world').dispatchEvent(evt)

    expect(screen.queryByText('复制')).toBeNull()
    expect(evt.defaultPrevented).toBe(true)
  })

  it('"添加到聊天" calls addUserSelection with the selected text', () => {
    render(
      <SelectionContextMenuZone>
        <p>hello world</p>
      </SelectionContextMenuZone>,
    )

    mockSelection('hello')
    fireEvent.contextMenu(screen.getByText('hello world'), { clientX: 0, clientY: 0 })

    act(() => {
      screen.getByText('添加到聊天').click()
    })

    expect(addUserSelection).toHaveBeenCalledWith('hello')
  })

  it('"复制" writes selected text to clipboard and closes the menu', () => {
    render(
      <SelectionContextMenuZone>
        <p>hello world</p>
      </SelectionContextMenuZone>,
    )

    mockSelection('hello')
    fireEvent.contextMenu(screen.getByText('hello world'), { clientX: 0, clientY: 0 })

    act(() => {
      screen.getByText('复制').click()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    expect(screen.queryByText('复制')).toBeNull()
  })
})
