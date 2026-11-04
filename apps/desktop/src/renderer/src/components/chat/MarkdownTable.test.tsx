/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyableMarkdown } from './CopyableMarkdown'

const TABLE = [
  '| Name | Value |',
  '| --- | --- |',
  '| Alice | a\\|b |',
  '| Bob | 2 |',
].join('\n')

describe('markdown table actions', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })
  afterEach(cleanup)

  it('copies only the selected table as valid Markdown with escaped pipes', async () => {
    const { container } = render(<CopyableMarkdown text={`Before\n\n${TABLE}\n\nAfter\n\n| Other |\n| --- |\n| 3 |`} isStreaming={false} />)
    const tables = container.querySelectorAll('[data-streamdown="table-wrapper"]')
    const copy = within(tables[0] as HTMLElement).getByRole('button', { name: 'Copy Table' })
    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TABLE))
    expect(copy.querySelector('.lucide-check')).not.toBeNull()
    expect(copy.compareDocumentPosition(within(tables[0] as HTMLElement).getByRole('button', { name: 'Expand' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('copies the latest rows after a streaming update', async () => {
    const { container, rerender } = render(<CopyableMarkdown text={TABLE} isStreaming />)
    rerender(<CopyableMarkdown text={`${TABLE}\n| Carol | 3 |`} isStreaming={false} />)
    fireEvent.click(within(container).getByRole('button', { name: 'Copy Table' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${TABLE}\n| Carol | 3 |`))
  })

  it('does not show success if the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('Clipboard denied'))
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    const copy = within(container).getByRole('button', { name: 'Copy Table' })
    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(copy.querySelector('.lucide-check')).toBeNull()
  })

  it('turns each original row into a column and copies that orientation', async () => {
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    const transpose = within(container).getByRole('button', { name: 'Transpose Table' })
    expect(transpose.querySelector('.lucide-rotate-cw-square')).not.toBeNull()
    fireEvent.click(transpose)
    expect(transpose.querySelector('.lucide-rotate-ccw-square')).not.toBeNull()

    const table = within(container).getByRole('table')
    expect(within(table).queryAllByRole('columnheader')).toEqual([])
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Name', 'Value'])
    const rows = within(table).getAllByRole('row')
    expect(within(rows[0]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Alice', 'Bob'])
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['a|b', '2'])
    const classes = transpose.className.split(/\s+/)
    expect(classes).toContain('hover:text-foreground')
    expect(classes).not.toContain('text-foreground')
    expect(classes).not.toContain('opacity-100')

    fireEvent.click(within(container).getByRole('button', { name: 'Copy Table' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith([
      '| Name | Alice | Bob |',
      '| --- | --- | --- |',
      '| Value | a\\|b | 2 |',
    ].join('\n')))

    fireEvent.click(within(container).getByRole('button', { name: 'Original Layout' }))
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Name', 'Value'])
  })

  it('keeps the header mark on cells that move, and marks the new column headers', () => {
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    fireEvent.click(within(container).getByRole('button', { name: 'Transpose Table' }))
    const table = within(container).getByRole('table')
    expect(within(table).queryAllByRole('columnheader')).toEqual([])
    // Name and Value were the column headers. They stay marked. Alice was a body cell and stays one.
    expect([...table.querySelectorAll('[data-table-mark]')].map((cell) => cell.textContent)).toEqual(['Name', 'Value'])
    const alice = table.querySelector('[data-table-cell="1:0"]')
    expect(alice?.textContent).toBe('Alice')
    expect(alice?.tagName).toBe('TD')
    expect(alice?.hasAttribute('data-table-mark')).toBe(false)
  })

  it('slides each cell from its old position', () => {
    const seen = new Map<string, number>()
    const rect = (left: number, top: number) => ({
      x: left, y: top, left, top, right: left + 10, bottom: top + 10, width: 10, height: 10, toJSON() { return {} },
    })
    const original = HTMLElement.prototype.getBoundingClientRect
    const animate = vi.fn((_keyframes: Keyframe[]) => ({ finished: Promise.resolve(), cancel() {} }))
    HTMLElement.prototype.getBoundingClientRect = function () {
      const id = this.getAttribute('data-table-cell') ?? ''
      const n = seen.get(id) ?? 0
      seen.set(id, n + 1)
      return n === 0 ? rect(0, 0) : rect(40, 24)
    }
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
      fireEvent.click(within(container).getByRole('button', { name: 'Transpose Table' }))
      const frames = animate.mock.calls[0][0]
      expect(frames[0]?.transform).toBe('translate(-40px, -24px)')
      expect(frames[1]?.transform).toBe('translate(0, 0)')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
      Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    }
  })

  it('shows the transposed rows in the fullscreen table', async () => {
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    fireEvent.click(within(container).getByRole('button', { name: 'Transpose Table' }))
    fireEvent.click(within(container).getByRole('button', { name: 'Expand' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Table' })
    expect(within(dialog).queryAllByRole('columnheader')).toEqual([])
    expect(within(dialog).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['Name', 'Value'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Original Layout' }))
    expect(within(dialog).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Name', 'Value'])
  })

  it('still opens the full table and closes it with Escape', async () => {
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    fireEvent.click(within(container).getByRole('button', { name: 'Expand' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Table' })
    expect(within(dialog).getByRole('table')).toHaveTextContent('Alicea|bBob2')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  })
})
