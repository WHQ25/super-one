/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Streamdown } from 'streamdown'
import { createStreamdownCodeComponent, HighlightedCodeBlock } from './CodeBlock'
import { codePlugin } from './chat-shared'

vi.mock('./MermaidBlock', () => ({
  MermaidBlock: ({ isComplete }: { isComplete: boolean }) => (
    <div data-testid="mermaid" data-complete={String(isComplete)} />
  ),
}))

const CodeComponent = createStreamdownCodeComponent(codePlugin)

function renderStreaming(md: string) {
  return render(
    <Streamdown components={{ code: CodeComponent } as never} isAnimating>
      {md}
    </Streamdown>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('block-complete rendering during streaming', () => {
  it('marks a closed mermaid fence complete even while the message is still streaming', async () => {
    renderStreaming('```mermaid\ngraph TD\n  A-->B\n```\n\nafter text')
    const el = await screen.findByTestId('mermaid')
    expect(el.getAttribute('data-complete')).toBe('true')
  })

  it('keeps an unclosed mermaid fence incomplete while it is the streaming tail', async () => {
    renderStreaming('```mermaid\ngraph TD\n  A-->B')
    const el = await screen.findByTestId('mermaid')
    expect(el.getAttribute('data-complete')).toBe('false')
  })

  it('renders an incomplete code fence as plain text without syntax tokens', () => {
    const { container } = render(
      <HighlightedCodeBlock code={'const a = 1\nconst b = 2'} language="ts" codePlugin={codePlugin} isComplete={false} />,
    )
    const codeEl = container.querySelector('pre code')
    expect(codeEl?.textContent).toBe('const a = 1\nconst b = 2')
    expect(codeEl?.querySelector('span')).toBeNull()
  })
})
