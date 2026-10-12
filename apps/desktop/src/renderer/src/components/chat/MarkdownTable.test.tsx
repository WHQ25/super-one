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

  it('still opens the full table and closes it with Escape', async () => {
    const { container } = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)
    fireEvent.click(within(container).getByRole('button', { name: 'Expand' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Table' })
    expect(within(dialog).getByRole('table')).toHaveTextContent('Alicea|bBob2')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  })
})
