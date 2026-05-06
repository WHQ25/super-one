/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FileSelectionContextMenuZone,
  captureFileSelection,
  getRowCodeText,
  getColInRow,
} from './FileSelectionContextMenuZone'

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

function buildRow(lineNum: number, code: string, kind: string = 'unchanged'): HTMLDivElement {
  const row = document.createElement('div')
  row.setAttribute('data-line', String(lineNum))
  row.setAttribute('data-line-kind', kind)
  const gutter = document.createElement('span')
  gutter.className = 'select-none'
  gutter.textContent = String(lineNum)
  row.appendChild(gutter)
  const marker = document.createElement('span')
  marker.className = 'select-none'
  marker.textContent = ' '
  row.appendChild(marker)
  const codeNode = document.createElement('span')
  codeNode.textContent = code
  row.appendChild(codeNode)
  return row
}

function buildContainer(rows: { lineNum: number; code: string; kind?: string }[]): { container: HTMLDivElement; rows: HTMLDivElement[] } {
  const container = document.createElement('div')
  const built = rows.map((r) => buildRow(r.lineNum, r.code, r.kind))
  built.forEach((row) => container.appendChild(row))
  document.body.appendChild(container)
  return { container, rows: built }
}

function makeSelection(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const text = range.toString()
  return {
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => range,
  } as unknown as Selection
}

describe('getRowCodeText', () => {
  it('returns full code text excluding select-none gutter and marker', () => {
    const row = buildRow(42, 'const a = 1')
    expect(getRowCodeText(row)).toBe('const a = 1')
  })
})

describe('getColInRow', () => {
  it('counts char offset from start of code, ignoring select-none children', () => {
    const row = buildRow(10, 'const a = 1')
    const codeText = row.lastElementChild!.firstChild as Text
    expect(getColInRow(row, codeText, 6)).toBe(6)
  })

  it('returns 0 when container is outside the row', () => {
    const row = buildRow(10, 'foo')
    const stranger = document.createTextNode('bar')
    expect(getColInRow(row, stranger, 1)).toBe(0)
  })
})

describe('captureFileSelection', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('captures full row contents joined by newlines for multi-line selection', () => {
    const { rows } = buildContainer([
      { lineNum: 10, code: 'const a = 1' },
      { lineNum: 11, code: 'const b = 2' },
      { lineNum: 12, code: 'const c = 3' },
    ])
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[2].lastElementChild!.firstChild as Text
    const sel = makeSelection(startText, 6, endText, 7)

    const captured = captureFileSelection('/abs/foo.ts', sel)
    expect(captured).not.toBeNull()
    expect(captured!.quoteText).toBe(
      '/abs/foo.ts:L10-L12:C6-C7\nconst a = 1\nconst b = 2\nconst c = 3',
    )
    expect(captured!.copyText).toBe('a = 1\nconst b = 2\nconst c')
  })

  it('captures full single line with col range when selection is within one line', () => {
    const { rows } = buildContainer([{ lineNum: 42, code: 'function greet(name) {}' }])
    const code = rows[0].lastElementChild!.firstChild as Text
    const sel = makeSelection(code, 9, code, 14)

    const captured = captureFileSelection('/abs/foo.ts', sel)
    expect(captured!.quoteText).toBe('/abs/foo.ts:L42:C9-C14\nfunction greet(name) {}')
    expect(captured!.copyText).toBe('greet')
  })

  it('emits unified-diff body with markers when selection spans removed/added rows', () => {
    const { rows } = buildContainer([
      { lineNum: 10, code: 'context one' },
      { lineNum: 11, code: 'old line', kind: 'removed' },
      { lineNum: 11, code: 'new line', kind: 'added' },
      { lineNum: 12, code: 'context two' },
    ])
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[3].lastElementChild!.firstChild as Text
    const sel = makeSelection(startText, 0, endText, 11)

    const captured = captureFileSelection('/abs/foo.ts', sel)
    expect(captured!.quoteText).toBe(
      '/abs/foo.ts:L10-L12:C0-C11:D\n context one\n-old line\n+new line\n context two',
    )
  })

  it('uses provided fileContent (canonical) instead of DOM-row text when available', () => {
    const { rows } = buildContainer([
      { lineNum: 2, code: 'render-shifted-text-A' },
      { lineNum: 3, code: 'render-shifted-text-B' },
    ])
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[1].lastElementChild!.firstChild as Text
    const sel = makeSelection(startText, 0, endText, 5)

    const fileContent = 'line1\nfile-truth-A\nfile-truth-B\nline4'
    const captured = captureFileSelection('/abs/foo.ts', sel, fileContent)
    expect(captured!.quoteText).toBe('/abs/foo.ts:L2-L3:C0-C5\nfile-truth-A\nfile-truth-B')
    expect(captured!.copyText).toBe('file-truth-A\nfile-')
  })

  it('keeps DOM text for removed-kind rows even when fileContent is provided', () => {
    const { rows } = buildContainer([
      { lineNum: 11, code: 'old line', kind: 'removed' },
      { lineNum: 11, code: 'new line', kind: 'added' },
    ])
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[1].lastElementChild!.firstChild as Text
    const sel = makeSelection(startText, 0, endText, 8)

    const fileContent = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nnew line\nline12'
    const captured = captureFileSelection('/abs/foo.ts', sel, fileContent)
    expect(captured!.quoteText).toBe('/abs/foo.ts:L11:C0-C8:D\n-old line\n+new line')
  })

  it('falls back to DOM text when fileContent is null', () => {
    const { rows } = buildContainer([{ lineNum: 5, code: 'dom only' }])
    const code = rows[0].lastElementChild!.firstChild as Text
    const sel = makeSelection(code, 0, code, 8)
    const captured = captureFileSelection('/abs/foo.ts', sel, null)
    expect(captured!.quoteText).toBe('/abs/foo.ts:L5:C0-C8\ndom only')
  })

  it('skips :D and emits plain body when all rows are unchanged', () => {
    const { rows } = buildContainer([
      { lineNum: 10, code: 'const a = 1' },
      { lineNum: 11, code: 'const b = 2' },
    ])
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[1].lastElementChild!.firstChild as Text
    const sel = makeSelection(startText, 0, endText, 11)

    const captured = captureFileSelection('/abs/foo.ts', sel)
    expect(captured!.quoteText).toBe('/abs/foo.ts:L10-L11:C0-C11\nconst a = 1\nconst b = 2')
    expect(captured!.quoteText).not.toContain(':D')
  })

  it('falls back to plain selection text when no row ancestor exists', () => {
    const p = document.createElement('p')
    p.textContent = 'plain selection'
    document.body.appendChild(p)
    const text = p.firstChild as Text
    const sel = makeSelection(text, 0, text, 5)

    const captured = captureFileSelection('/abs/foo.ts', sel)
    expect(captured!.quoteText).toBe('plain')
    expect(captured!.copyText).toBe('plain')
  })

  it('returns null when selection is empty and no rows resolve', () => {
    const p = document.createElement('p')
    p.textContent = 'x'
    document.body.appendChild(p)
    const text = p.firstChild as Text
    const sel = makeSelection(text, 0, text, 0)
    expect(captureFileSelection('/abs/foo.ts', sel)).toBeNull()
  })
})

describe('FileSelectionContextMenuZone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    addUserSelection.mockClear()
    ;(navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockClear()
    document.body.innerHTML = ''
  })

  it('does not render any menu by default', () => {
    render(
      <FileSelectionContextMenuZone filePath="/abs/foo.ts">
        <p>code</p>
      </FileSelectionContextMenuZone>,
    )
    expect(screen.queryByText('复制')).toBeNull()
    expect(screen.queryByText('添加到聊天')).toBeNull()
  })

  it('does not open the menu when no text is selected and suppresses default', () => {
    render(
      <FileSelectionContextMenuZone filePath="/abs/foo.ts">
        <p>hello world</p>
      </FileSelectionContextMenuZone>,
    )
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 0,
      toString: () => '',
      getRangeAt: () => document.createRange(),
    } as unknown as Selection)
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
    screen.getByText('hello world').dispatchEvent(evt)
    expect(screen.queryByText('复制')).toBeNull()
    expect(evt.defaultPrevented).toBe(true)
  })

  it('"添加到聊天" sends quoteText with full line content and col range', () => {
    const { rows } = buildContainer([
      { lineNum: 10, code: 'const a = 1' },
      { lineNum: 11, code: 'const b = 2' },
    ])
    render(
      <FileSelectionContextMenuZone filePath="/abs/path/foo.ts">
        <p>some code</p>
      </FileSelectionContextMenuZone>,
    )
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[1].lastElementChild!.firstChild as Text
    vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(startText, 6, endText, 7))
    fireEvent.contextMenu(screen.getByText('some code'), { clientX: 0, clientY: 0 })
    act(() => {
      screen.getByText('添加到聊天').click()
    })
    expect(addUserSelection).toHaveBeenCalledWith(
      '/abs/path/foo.ts:L10-L11:C6-C7\nconst a = 1\nconst b = 2',
    )
  })

  it('"复制" copies the actually selected substring without prefix', () => {
    const { rows } = buildContainer([
      { lineNum: 10, code: 'const a = 1' },
      { lineNum: 11, code: 'const b = 2' },
    ])
    render(
      <FileSelectionContextMenuZone filePath="/abs/path/foo.ts">
        <p>some code</p>
      </FileSelectionContextMenuZone>,
    )
    const startText = rows[0].lastElementChild!.firstChild as Text
    const endText = rows[1].lastElementChild!.firstChild as Text
    vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(startText, 6, endText, 7))
    fireEvent.contextMenu(screen.getByText('some code'), { clientX: 0, clientY: 0 })
    act(() => {
      screen.getByText('复制').click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('a = 1\nconst b')
  })
})
