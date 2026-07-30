/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { resolveMarkdownFileLinks, streamdownRehypePlugins } from './chat-shared'

function renderMarkdown(md: string): string {
  let processor = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true })
  for (const plugin of streamdownRehypePlugins) {
    processor = Array.isArray(plugin)
      ? processor.use(plugin[0] as never, plugin[1] as never)
      : processor.use(plugin as never)
  }
  return String(processor.use(rehypeStringify, { allowDangerousHtml: true }).processSync(md))
}

describe('chat markdown link hardening', () => {
  it('renders project-relative file links after absolute pre-resolve (chat pipeline)', () => {
    // Chat always runs resolveMarkdownFileLinks first so bare relative targets become
    // absolute filesystem paths — never https://localhost.
    const project = '/Users/me/proj'
    const pre = resolveMarkdownFileLinks('see [claude-query.ts](apps/desktop/src/x.ts)', project)
    expect(pre).toContain(`](${project}/apps/desktop/src/x.ts)`)
    const html = renderMarkdown(pre)
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('https://localhost')
    expect(html).toContain('<a')
    expect(html).toContain(`href="${project}/apps/desktop/src/x.ts"`)
  })

  it('preserves path-style relative links without inventing an https://localhost origin', () => {
    // Leading ./ is path-relative for rehype-harden; bare "apps/..." is pre-resolved
    // to an absolute filesystem path by resolveMarkdownFileLinks before render.
    const html = renderMarkdown('see [superone-mcp-server.ts](./apps/desktop/src/main/mcp/superone-mcp-server.ts)')
    expect(html).not.toContain('https://localhost')
    expect(html).toContain('href="/apps/desktop/src/main/mcp/superone-mcp-server.ts"')
  })

  it('preserves an absolute project-style path as an anchor', () => {
    const html = renderMarkdown('[file](/Users/me/repo/x.ts)')
    expect(html).not.toContain('[blocked]')
    expect(html).toContain('<a')
    expect(html).toContain('href="/Users/me/repo/x.ts"')
  })

  it('degrades a javascript: link to text with no href and no [blocked] badge', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('javascript:')
  })
})
