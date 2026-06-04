/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { streamdownRehypePlugins } from './chat-shared'

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
  it('renders a bare relative-path link as a clickable anchor, not a [blocked] indicator', () => {
    const html = renderMarkdown('see [claude-query.ts](apps/desktop/src/x.ts)')
    expect(html).not.toContain('[blocked]')
    expect(html).toContain('<a')
  })

  it('preserves an absolute project-style path as an anchor', () => {
    const html = renderMarkdown('[file](/Users/me/repo/x.ts)')
    expect(html).not.toContain('[blocked]')
    expect(html).toContain('<a')
  })

  it('degrades a javascript: link to text with no href and no [blocked] badge', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('[blocked]')
    expect(html).not.toContain('javascript:')
  })
})
