/** @vitest-environment jsdom */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CopyableMarkdown, splitByCodeFences, normalizeCodeFences, splitByInsightBlocks } from './CopyableMarkdown'

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

describe('splitByInsightBlocks', () => {
  it('extracts insight block with wrapping backticks', () => {
    const text = 'Before\n`★ Insight ─────────────────`\nBody line\n`─────────────────────────────`\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'insight', title: 'Insight', content: 'Body line' },
      { type: 'text', content: 'After' },
    ])
  })

  it('extracts insight block without wrapping backticks', () => {
    const text = 'Before\n★ Insight ─────────────────\nBody line\n─────────────────────────────\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'insight', title: 'Insight', content: 'Body line' },
      { type: 'text', content: 'After' },
    ])
  })

  it('recognizes a header whose long title leaves only a single trailing dash', () => {
    const text = '`★ 因为"SVG 硬件加速"有一堆没写在博客里的失效条件 ─`\nBody line\n─────────────────────────────`'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: '因为"SVG 硬件加速"有一堆没写在博客里的失效条件', content: 'Body line' },
    ])
  })

  it('tolerates trailing whitespace on header and footer', () => {
    const text = '★ Title ─────────────   \nBody\n─────────────────────   '
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Title', content: 'Body' },
    ])
  })

  it('strips wrapping code fences around an insight block', () => {
    const text = '```\n★ Insight ─────────────────\nBody line\n─────────────────────────────\n```'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Body line' },
    ])
  })

  it('strips wrapping code fences with a language tag', () => {
    const text = 'Before\n```markdown\n★ Insight ─────────────────\nBody\n─────────────────────────────\n```\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'insight', title: 'Insight', content: 'Body' },
      { type: 'text', content: 'After' },
    ])
  })

  it('leaves genuine code blocks untouched', () => {
    const text = '```ts\nconst x = 1\n```'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: '```ts\nconst x = 1\n```' },
    ])
  })

  it('does not strip an unmatched leading fence', () => {
    const text = '```\n★ Insight ─────────────\nBody\n─────────────────────\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: '```' },
      { type: 'insight', title: 'Insight', content: 'Body' },
      { type: 'text', content: 'After' },
    ])
  })

  it('does not strip an unmatched trailing fence', () => {
    const text = '★ Insight ─────────────\nBody\n─────────────────────\n```'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Body' },
      { type: 'text', content: '```' },
    ])
  })

  it('extracts insight when footer dashes are glued to the last content line', () => {
    const text = '★ Insight ─────────────────\nLine 1\nLine 2 ─────────────────────────────\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Line 1\nLine 2' },
      { type: 'text', content: 'After' },
    ])
  })

  it('extracts insight with inline footer wrapped in backticks', () => {
    const text = '`★ Insight ─────────────────`\nLine 1\nLine 2 `─────────────────────────────`\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Line 1\nLine 2' },
      { type: 'text', content: 'After' },
    ])
  })

  it('extracts insight when header is wrapped in a markdown heading', () => {
    const text = 'Pre.\n\n## `★ Insight ─────────────────────────────────────`\n- **a**: x\n- **b**: y\n`─────────────────────────────────────────────────`\n\nPost.'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Pre.\n' },
      { type: 'insight', title: 'Insight', content: '- **a**: x\n- **b**: y' },
      { type: 'text', content: '\nPost.' },
    ])
  })

  it('splits off leading prose glued to the header on the same line', () => {
    const text = '一条 15% 的线就被边框吃掉了。`★ Insight ─────────────────`\nBody line\n`─────────────────────────────`\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: '一条 15% 的线就被边框吃掉了。' },
      { type: 'insight', title: 'Insight', content: 'Body line' },
      { type: 'text', content: 'After' },
    ])
  })

  it('splits off leading prose when header has no wrapping backticks', () => {
    const text = 'Preceding sentence. ★ Insight ─────────────────\nBody\n─────────────────────────────'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Preceding sentence.' },
      { type: 'insight', title: 'Insight', content: 'Body' },
    ])
  })

  it('extracts a blockquoted insight block and strips the > prefix from every line', () => {
    const text = 'Before\n> `★ Insight ─────────────────`\n> - point a\n> - point b\n> `─────────────────────────────`\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'insight', title: 'Insight', content: '- point a\n- point b' },
      { type: 'text', content: 'After' },
    ])
  })

  it('extracts a blockquoted insight block without wrapping backticks', () => {
    const text = '> ★ Insight ─────────────────\n> Body\n> ─────────────────────────────'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Body' },
    ])
  })

  it('extracts an indented insight block and strips the indent', () => {
    const text = '  `★ Insight ─────────────────`\n  Body\n  `─────────────────────────────`'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Body' },
    ])
  })
})

