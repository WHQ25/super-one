/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CopyableMarkdown, splitByCodeFences } from './CopyableMarkdown'

vi.mock('streamdown', () => ({
  Streamdown: ({ children, className }: { children: string; className?: string }) => (
    <div className={className}>
      {children.includes('```')
        ? (
          <>
            <p>text before</p>
            <div data-chat-codeblock>code block</div>
            <p>text after</p>
          </>
        )
        : <p>{children}</p>}
    </div>
  ),
}))

vi.mock('./chat-shared', () => ({
  codePlugin: {},
  streamdownPlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: undefined,
}))

vi.mock('./CodeBlock', () => ({
  createStreamdownCodeComponent: () => 'code',
}))

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

describe('splitByCodeFences', () => {
  it('splits text with code fences', () => {
    const result = splitByCodeFences('hello\n```ts\ncode\n```\nworld')
    expect(result).toEqual([
      { content: 'hello', isCode: false },
      { content: '```ts\ncode\n```', isCode: true },
      { content: 'world', isCode: false },
    ])
  })

  it('handles text without code fences', () => {
    const result = splitByCodeFences('just text')
    expect(result).toEqual([{ content: 'just text', isCode: false }])
  })

  it('handles multiple code fences', () => {
    const result = splitByCodeFences('intro\n```js\na\n```\nmiddle\n```py\nb\n```\nend')
    expect(result).toEqual([
      { content: 'intro', isCode: false },
      { content: '```js\na\n```', isCode: true },
      { content: 'middle', isCode: false },
      { content: '```py\nb\n```', isCode: true },
      { content: 'end', isCode: false },
    ])
  })

  it('handles unclosed code fence', () => {
    const result = splitByCodeFences('text\n```ts\ncode')
    expect(result).toEqual([
      { content: 'text', isCode: false },
      { content: '```ts\ncode', isCode: true },
    ])
  })

  it('handles empty text', () => {
    const result = splitByCodeFences('')
    expect(result).toEqual([{ content: '', isCode: false }])
  })

  it('handles code fence only', () => {
    const result = splitByCodeFences('```ts\ncode\n```')
    expect(result).toEqual([{ content: '```ts\ncode\n```', isCode: true }])
  })
})

describe('CopyableMarkdown', () => {
  it('shows the copy button when hovering non-codeblock text', () => {
    const { container } = render(
      <CopyableMarkdown text="A long paragraph of text" isStreaming={false} />,
    )

    expect(container.querySelector('button')).toBeNull()

    fireEvent.pointerMove(screen.getByText('A long paragraph of text'))

    const button = container.querySelector('button')
    expect(button).toBeTruthy()
    expect(button?.className).toContain('cursor-pointer')
  })

  it('hides the copy button while hovering a code block', () => {
    const { container } = render(
      <CopyableMarkdown text={'```ts\nconst x = 1\n```'} isStreaming={false} />,
    )

    fireEvent.pointerMove(screen.getByText('code block'))

    expect(container.querySelector('button')).toBeNull()
  })

  it('does not show copy button while streaming', () => {
    const { container } = render(
      <CopyableMarkdown text="some text" isStreaming={true} />,
    )

    fireEvent.pointerMove(screen.getByText('some text'))

    expect(container.querySelector('button')).toBeNull()
  })
})
