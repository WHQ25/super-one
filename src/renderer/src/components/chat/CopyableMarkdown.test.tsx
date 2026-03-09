/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CopyableMarkdown } from './CopyableMarkdown'

vi.mock('streamdown', () => ({
  Streamdown: ({ children, className }: { children: string; className?: string }) => (
    <div className={className}>
      {children.includes('```')
        ? <div data-chat-codeblock>code block</div>
        : children}
    </div>
  ),
}))

vi.mock('./chat-shared', () => ({
  streamdownPlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: undefined,
}))

describe('CopyableMarkdown', () => {
  it('renders the copy button with a background', () => {
    const { container } = render(
      <CopyableMarkdown text="A long paragraph of text" isStreaming={false} />,
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()
    expect(button?.className).toContain('bg-background/85')
  })

  it('hides the message copy button while hovering a code block', () => {
    const { container } = render(
      <CopyableMarkdown text={'```ts\nconst x = 1\n```'} isStreaming={false} />,
    )

    expect(container.querySelector('button')).toBeTruthy()

    fireEvent.pointerMove(screen.getByText('code block'))

    expect(container.querySelector('button')).toBeNull()
  })
})
