import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocksFast } from './markdown-blocks'

describe('parseMarkdownBlocksFast', () => {
  it('splits headings, paragraphs, and lists into blocks', () => {
    const md = '# Title\n\nFirst paragraph.\n\n## Sub\n\n- one\n- two\n'
    expect(parseMarkdownBlocksFast(md)).toEqual([
      '# Title',
      'First paragraph.',
      '## Sub',
      '- one\n- two',
    ])
  })

  it('keeps fenced code blocks with blank lines intact', () => {
    const md = 'Intro\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nOutro'
    expect(parseMarkdownBlocksFast(md)).toEqual([
      'Intro',
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      'Outro',
    ])
  })

  it('keeps display math blocks and html container blocks intact', () => {
    const md = '$$\na + b\n\nc + d\n$$\n\n<details>\n<summary>Hi</summary>\n\nBody\n\n</details>\n\nAfter'
    expect(parseMarkdownBlocksFast(md)).toEqual([
      '$$\na + b\n\nc + d\n$$',
      '<details>\n<summary>Hi</summary>\n\nBody\n\n</details>',
      'After',
    ])
  })

  it('keeps ordered lists with blank lines in one block', () => {
    const md = '1. first\n\n2. second\n\nParagraph'
    expect(parseMarkdownBlocksFast(md)).toEqual([
      '1. first\n\n2. second',
      'Paragraph',
    ])
  })

  it('keeps documents with footnotes or reference link definitions atomic', () => {
    const withRef = 'See [site][1].\n\n[1]: https://example.com\n'
    const withFootnote = 'Note[^1].\n\n[^1]: Detail\n'
    expect(parseMarkdownBlocksFast(withRef)).toEqual([withRef])
    expect(parseMarkdownBlocksFast(withFootnote)).toEqual([withFootnote])
  })

  it('splits large CHANGELOG.md in linear time', () => {
    const changelogPath = resolve(__dirname, '../../../../CHANGELOG.md')
    const changelog = readFileSync(changelogPath, 'utf8')
    const start = performance.now()
    const blocks = parseMarkdownBlocksFast(changelog)
    const elapsed = performance.now() - start
    expect(blocks.length).toBeGreaterThan(500)
    expect(blocks[0]).toBe('# Changelog')
    expect(elapsed).toBeLessThan(150)
  })
})
