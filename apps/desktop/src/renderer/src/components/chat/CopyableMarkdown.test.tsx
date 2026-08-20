/** @vitest-environment jsdom */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CopyableMarkdown, splitByCodeFences, normalizeCodeFences } from './CopyableMarkdown'

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
  streamdownPlugins: {},
  streamdownRehypePlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: undefined,
  loadMathPlugin: () => Promise.resolve(null),
  getMathPluginSync: () => null,
}))

vi.mock('./CodeBlock', () => ({
  createStreamdownCodeComponent: () => 'code',
}))

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
})

describe('streaming text rendering', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('commits incremental text updates to the DOM while streaming', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<CopyableMarkdown text="" isStreaming />)

    for (const next of ['你好', '你好，世', '你好，世界']) {
      rerender(<CopyableMarkdown text={next} isStreaming />)
    }
    act(() => { vi.advanceTimersByTime(50) })

    expect(container.textContent).toContain('你好，世界')
  })

  it('shows the final text immediately once streaming ends', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<CopyableMarkdown text="partial" isStreaming />)
    rerender(<CopyableMarkdown text="partial answer complete" isStreaming={false} />)

    expect(container.textContent).toContain('partial answer complete')
  })
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

  it('handles nested code fences inside markdown block', () => {
    const input = '```markdown\n# Title\n```python\nprint("hi")\n```\nMore text\n```\nafter'
    const result = splitByCodeFences(input)
    expect(result).toEqual([
      { content: '```markdown\n# Title\n```python\nprint("hi")\n```\nMore text\n```', isCode: true },
      { content: 'after', isCode: false },
    ])
  })

  it('handles multiple nested code fences inside markdown block', () => {
    const input = '```markdown\n```js\na\n```\n```py\nb\n```\n```\nend'
    const result = splitByCodeFences(input)
    expect(result).toEqual([
      { content: '```markdown\n```js\na\n```\n```py\nb\n```\n```', isCode: true },
      { content: 'end', isCode: false },
    ])
  })
})

describe('normalizeCodeFences', () => {
  it('returns text unchanged when no nesting', () => {
    const input = 'hello\n```ts\ncode\n```\nworld'
    expect(normalizeCodeFences(input)).toBe(input)
  })

  it('upgrades outer fence when inner fences use same backtick count', () => {
    const input = '```markdown\n# Title\n```python\nprint("hi")\n```\nMore text\n```'
    const result = normalizeCodeFences(input)
    expect(result).toBe('````markdown\n# Title\n```python\nprint("hi")\n```\nMore text\n````')
  })

  it('upgrades outer fence with multiple nested blocks', () => {
    const input = '```markdown\n```js\na\n```\n```py\nb\n```\n```'
    const result = normalizeCodeFences(input)
    expect(result).toBe('````markdown\n```js\na\n```\n```py\nb\n```\n````')
  })

  it('preserves surrounding text', () => {
    const input = 'before\n```markdown\n```json\n{}\n```\ntext\n```\nafter'
    const result = normalizeCodeFences(input)
    expect(result).toBe('before\n````markdown\n```json\n{}\n```\ntext\n````\nafter')
  })

  it('handles unclosed nested fence', () => {
    const input = '```markdown\n```json\n{}\n```'
    const result = normalizeCodeFences(input)
    expect(result).toBe('````markdown\n```json\n{}\n````')
  })
})
