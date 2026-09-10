/** @vitest-environment jsdom */

import { describe, expect, it, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CopyableMarkdown } from './CopyableMarkdown'

/**
 * Streamdown's `remend` repair pass used to strip everything from an unclosed
 * `<tag` to the end of the text, with no regard for math or code context. A
 * `\sum_{j<k}` therefore deleted the rest of the turn and left a muted KaTeX
 * parse error in its place. These render the real Streamdown (no mock) because
 * the bug lived entirely in that pre-parse repair.
 */
describe('text after an unclosed angle bracket', () => {
  afterEach(cleanup)

  async function renderMarkdown(text: string) {
    let container!: HTMLElement
    await act(async () => { container = render(<CopyableMarkdown text={text} isStreaming={false} />).container })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    return container
  }

  it('keeps display math with `<` and everything after it', async () => {
    const container = await renderMarkdown('前文\n\n$$\nI = \\sum_{j<k} p_j\n$$\n\n结尾段落')

    expect(container.innerHTML).not.toContain('katex-error')
    expect(container.textContent).toContain('结尾段落')
  })

  it('keeps prose with `<` and everything after it', async () => {
    const container = await renderMarkdown('循环条件是 i<n 时继续\n\n结尾段落')

    expect(container.textContent).toContain('i<n 时继续')
    expect(container.textContent).toContain('结尾段落')
  })
})
