import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LARGE_MARKDOWN_CHAR_THRESHOLD,
  hasReferenceDefinitions,
  markdownToHtml,
  splitMarkdownChunks,
} from './markdown-html'

function buildLargeMarkdown(sections: number): string {
  return Array.from({ length: sections }, (_, i) =>
    `## Section ${i + 1}\n\n- Item ${i + 1}a with \`inline code\` and **bold** text.\n- Item ${i + 1}b with enough words to exceed the threshold cleanly.\n`,
  ).join('\n')
}

describe('markdown-html chunking and parsing', () => {
  it('returns null for small documents', () => {
    expect(splitMarkdownChunks('# Short\n\nParagraph\n')).toBeNull()
  })

  it('returns null when reference definitions exist', () => {
    const big = `${buildLargeMarkdown(300)}\n[ref]: https://example.com\n`
    expect(big.length).toBeGreaterThan(LARGE_MARKDOWN_CHAR_THRESHOLD)
    expect(hasReferenceDefinitions(big)).toBe(true)
    expect(splitMarkdownChunks(big)).toBeNull()
  })

  it('never splits inside fenced code blocks, math blocks, html blocks, or comments', () => {
    const fenced = '```ts\n' + Array.from({ length: 180 }, (_, i) => `const line${i} = ${i}\n`).join('\n') + '```\n'
    const details = '<details>\n<summary>Info</summary>\n\n' + Array.from({ length: 120 }, (_, i) => `Detail ${i}\n`).join('\n') + '\n</details>\n'
    const math = '$$\n' + Array.from({ length: 100 }, (_, i) => `x_${i} = ${i}\n`).join('\n') + '$$\n'
    const comment = '<!--\n' + Array.from({ length: 100 }, (_, i) => `note ${i}\n`).join('\n') + '-->\n'
    const doc = [fenced, details, math, comment, buildLargeMarkdown(200)].join('\n')

    const chunks = splitMarkdownChunks(doc)
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(1)
    expect(chunks!.some((c) => c.includes('```ts') && c.includes('```'))).toBe(true)
    expect(chunks!.some((c) => c.includes('<details>') && c.includes('</details>'))).toBe(true)
    expect(chunks!.some((c) => c.includes('$$\n') && c.trimEnd().endsWith('$$'))).toBe(true)
    expect(chunks!.some((c) => c.includes('<!--') && c.includes('-->'))).toBe(true)
  })

  it('splits real CHANGELOG.md cleanly and parses chunks with matching output', async () => {
    const changelogPath = resolve(__dirname, '../../../../../../../CHANGELOG.md')
    const changelog = readFileSync(changelogPath, 'utf8')
    const chunks = splitMarkdownChunks(changelog)
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(5)

    const headHtml = await markdownToHtml(chunks![0])
    expect(headHtml).toContain('<h1>Changelog</h1>')
    expect(headHtml).toContain('<h2>[Unreleased]</h2>')
  })
})
