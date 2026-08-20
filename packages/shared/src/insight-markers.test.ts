import { describe, it, expect } from 'vitest'
import {
  INSIGHT_HEADER_LINE,
  INSIGHT_FOOTER_LINE,
  INSIGHT_INLINE_FOOTER_LINE,
  findInsightBodyEnd,
  splitByInsightBlocks,
} from './insight-markers'

const DASHES = '─'.repeat(37)

describe('INSIGHT_HEADER_LINE', () => {
  it.each([
    ['bare', `★ Insight ${DASHES}`],
    ['backticks', `\`★ Insight ${DASHES}\``],
    ['bold', `**★ Insight ${DASHES}**`],
    ['heading + backticks', `## \`★ Insight ${DASHES}\``],
    ['bold with a single trailing dash', '**★ Insight ─**'],
  ])('matches a %s header', (_label, line) => {
    expect(line.match(INSIGHT_HEADER_LINE)?.[2]).toBe('Insight')
  })

  it('captures leading prose glued to a bold header', () => {
    const m = `结论如下。**★ Insight ${DASHES}**`.match(INSIGHT_HEADER_LINE)
    expect(m?.[1]).toBe('结论如下。')
    expect(m?.[2]).toBe('Insight')
  })

  it('ignores a bolded line that is not a marker', () => {
    expect('**just bold text**').not.toMatch(INSIGHT_HEADER_LINE)
  })
})

describe('INSIGHT_FOOTER_LINE', () => {
  it.each([
    ['bare', DASHES],
    ['backticks', `\`${DASHES}\``],
    ['bold', `**${DASHES}**`],
  ])('matches a %s footer', (_label, line) => {
    expect(line).toMatch(INSIGHT_FOOTER_LINE)
  })

  it('does not treat a bold footer as an inline footer', () => {
    expect(`**${DASHES}**`).not.toMatch(INSIGHT_INLINE_FOOTER_LINE)
  })

  it('matches a bold footer glued to the last content line', () => {
    expect(`最后一点 **${DASHES}**`.match(INSIGHT_INLINE_FOOTER_LINE)?.[1]).toBe('最后一点')
  })
})

describe('findInsightBodyEnd', () => {
  it('ends the body at its footer', () => {
    expect(findInsightBodyEnd(['a', 'b', DASHES, 'after'])).toEqual({ kind: 'footer', end: 2, next: 3, inlineContent: null })
  })

  it('keeps a paragraph break inside a body that a footer eventually closes', () => {
    expect(findInsightBodyEnd(['a', '', 'b', DASHES])).toMatchObject({ kind: 'footer', end: 3 })
  })

  it('falls back to the paragraph break when the footer never arrives', () => {
    expect(findInsightBodyEnd(['a', 'b', '', 'after'])).toEqual({ kind: 'break', end: 2, next: 2 })
  })

  it('holds a footerless body open mid-stream instead of closing on the break', () => {
    expect(findInsightBodyEnd(['a', 'b', '', 'after'], false)).toEqual({ kind: 'none' })
  })

  it('stops at the next header so a footerless block cannot claim its footer', () => {
    const body = ['a', `**\u2605 Second ${DASHES}**`, 'b', DASHES]
    expect(findInsightBodyEnd(body)).toEqual({ kind: 'break', end: 1, next: 1 })
  })

  it('reports no end while the body has no break and no footer', () => {
    expect(findInsightBodyEnd(['a', 'b'])).toEqual({ kind: 'none' })
  })

  it('reports no end for an empty body so a lone header stays text', () => {
    expect(findInsightBodyEnd(['', 'after'])).toEqual({ kind: 'none' })
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

  it('extracts an insight block whose markers are wrapped in bold', () => {
    const text = 'Before\n**\u2605 Insight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500**\nBody line\n**\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500**\nAfter'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'insight', title: 'Insight', content: 'Body line' },
      { type: 'text', content: 'After' },
    ])
  })

  it('closes a footerless insight block at the paragraph break', () => {
    const text = '**\u2605 Insight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500**\nBody line\n\nNext paragraph.'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'insight', title: 'Insight', content: 'Body line' },
      { type: 'text', content: '\nNext paragraph.' },
    ])
  })

  it('leaves a footerless insight block as text while its body is still streaming', () => {
    const text = '`\u2605 Insight \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`\nBody so f'
    const segments = splitByInsightBlocks(text)
    expect(segments).toEqual([
      { type: 'text', content: '`\u2605 Insight ' + '\u2500'.repeat(37) + '`\nBody so f' },
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
