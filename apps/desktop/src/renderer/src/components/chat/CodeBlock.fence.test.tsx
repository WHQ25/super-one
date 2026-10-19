/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { Streamdown } from 'streamdown'
import { HighlightedCodeBlock, createStreamdownCodeComponent } from './CodeBlock'
import { codePlugin } from './code-plugins'

const CodeComponent = createStreamdownCodeComponent(codePlugin)

describe('file citation fences', () => {
  it('highlights a start:end:path fence from the file extension', async () => {
    const language = '92:101:apps/desktop/src/session.ts'
    const { container } = render(
      <HighlightedCodeBlock
        code={'export const answer: number = 42\n'}
        language={language}
        codePlugin={codePlugin}
      />,
    )

    expect(container.textContent).toContain(language)
    await waitFor(() => {
      expect(container.querySelector('pre code span[style*="color"]')).not.toBeNull()
    })
  })

  it('keeps the path on a markdown citation fence and highlights the code', async () => {
    const { container } = render(
      <Streamdown components={{ code: CodeComponent } as never}>
        {'```92:101:src/session.ts\nexport const answer: number = 42\n```'}
      </Streamdown>,
    )

    await waitFor(() => {
      expect(container.textContent).toContain('92:101:src/session.ts')
      expect(container.querySelector('pre code span[style*="color"]')).not.toBeNull()
    })
  })
})
