/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CopyableMarkdown } from './CopyableMarkdown'

describe('streaming fade', () => {
  it('fades each newly committed prose chunk and leaves code alone', async () => {
    const { container, rerender } = render(<CopyableMarkdown text="Hello" isStreaming />)
    await waitFor(() => expect(container.querySelector('.stream-fade')?.textContent).toBe('Hello'))

    rerender(<CopyableMarkdown text="Hello there" isStreaming />)
    await waitFor(() => {
      expect([...container.querySelectorAll('.stream-fade')].map(node => node.textContent)).toEqual(['Hello', ' there'])
    })

    rerender(<CopyableMarkdown text={'Before\n\n```ts\nconst secret = 1\n```\n\nAfter'} isStreaming />)
    await waitFor(() => expect(container.textContent).toContain('secret'))
    const faded = [...container.querySelectorAll('.stream-fade')].map(node => node.textContent).join('')
    expect(faded).not.toContain('secret')
    expect(container.querySelector('pre .stream-fade')).toBeNull()
  })

  it('drops the fade once streaming ends', async () => {
    const { container, rerender } = render(<CopyableMarkdown text="Hello" isStreaming />)
    await waitFor(() => expect(container.querySelector('.stream-fade')).not.toBeNull())

    rerender(<CopyableMarkdown text="Hello there" isStreaming={false} />)
    await waitFor(() => expect(container.querySelector('.stream-fade')).toBeNull())
    expect(container.textContent).toContain('Hello there')
  })

  it('keeps the rendered blocks when streaming ends', async () => {
    const { container, rerender } = render(<CopyableMarkdown text="Hello" isStreaming />)
    await waitFor(() => expect(container.querySelector('.stream-fade')).not.toBeNull())
    const paragraph = container.querySelector('p')

    rerender(<CopyableMarkdown text="Hello" isStreaming={false} />)
    await waitFor(() => expect(container.querySelector('.stream-fade')).toBeNull())
    expect(container.querySelector('p')).toBe(paragraph)
  })
})
