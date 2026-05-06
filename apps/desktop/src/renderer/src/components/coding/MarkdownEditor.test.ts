import { common, createLowlight } from 'lowlight'
import { toHtml } from 'hast-util-to-html'
import { FRONTMATTER_RE, highlightMarkdownWithFrontmatter } from './MarkdownEditor'

const lowlight = createLowlight(common)

describe('FRONTMATTER_RE', () => {
  it('should match standard front matter', () => {
    const m = '---\ntitle: Hello\n---\n# Body'.match(FRONTMATTER_RE)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('title: Hello')
    expect(m![2]).toBe('# Body')
  })

  it('should match multi-line yaml', () => {
    const m = '---\ntitle: Hello\ntags: [a, b]\n---\nBody'.match(FRONTMATTER_RE)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('title: Hello\ntags: [a, b]')
  })

  it('should not match without closing fence', () => {
    expect('---\ntitle: Hello\n# Body'.match(FRONTMATTER_RE)).toBeNull()
  })

  it('should not match mid-file hr', () => {
    expect('# Title\n---\nfoo\n---\nbar'.match(FRONTMATTER_RE)).toBeNull()
  })

  it('should allow trailing spaces on fences', () => {
    const m = '---  \ntitle: x\n---\t\nBody'.match(FRONTMATTER_RE)
    expect(m).not.toBeNull()
  })
})

describe('highlightMarkdownWithFrontmatter', () => {
  it('should highlight yaml in front matter and markdown in body', () => {
    const input = '---\ntitle: Hello\n---\n# Heading\n'
    const tree = highlightMarkdownWithFrontmatter(lowlight, input)
    const html = toHtml(tree)
    expect(html).toContain('hljs-meta')
    expect(html).toContain('hljs-attr')
    expect(html).toContain('hljs-section')
  })

  it('should fall back to plain markdown when no front matter', () => {
    const input = '# Just a heading\n\nSome text.'
    const tree = highlightMarkdownWithFrontmatter(lowlight, input)
    const html = toHtml(tree)
    expect(html).not.toContain('hljs-meta')
    expect(html).toContain('hljs-section')
  })

  it('should preserve body code block highlighting after front matter', () => {
    const input = '---\ntitle: Test\n---\n```js\nconst x = 1\n```\n'
    const tree = highlightMarkdownWithFrontmatter(lowlight, input)
    const html = toHtml(tree)
    expect(html).toContain('hljs-code')
  })
})
