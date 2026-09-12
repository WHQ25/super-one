import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { decodeHostImageSrc, encodeHostImageSrc, HOST_IMAGE_PROTOCOL, remarkHostImages } from './host-image-src'
import { createMarkdownRehypePlugins } from './presenters/markdown-media'

/** The phone's pipeline as `PortableMarkdown` configures it, minus Streamdown's rendering. */
async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkHostImages)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(createMarkdownRehypePlugins({ srcProtocols: [HOST_IMAGE_PROTOCOL] }))
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
}

function srcOf(html: string): string | null {
  return /<img src="([^"]*)"/.exec(html)?.[1] ?? null
}

describe('host image src', () => {
  it('round-trips paths with spaces, Unicode, a literal percent and a hash', () => {
    for (const path of ['out/a.png', '/Users/me/截图 (1) 100%#.png', 'C:\\proj\\a.png', './rel/a.png']) {
      expect(decodeHostImageSrc(encodeHostImageSrc(path))).toBe(path)
    }
  })

  it('decodes only its own scheme', () => {
    expect(decodeHostImageSrc('https://x/a.png')).toBeNull()
    expect(decodeHostImageSrc('data:image/png;base64,AA')).toBeNull()
    expect(decodeHostImageSrc('/Users/me/a.png')).toBeNull()
    expect(decodeHostImageSrc(`${HOST_IMAGE_PROTOCOL}:`)).toBeNull()
    expect(decodeHostImageSrc(`${HOST_IMAGE_PROTOCOL}:%E0%A4%A`)).toBeNull()
  })

  it('carries a bare relative, absolute and Windows path through sanitize and harden', async () => {
    for (const path of ['out/compare/v2_01.png', '/Users/me/proj/out/a.png', 'C:\\proj\\a.png']) {
      const html = await render(`![alt](<${path}>)`)
      expect(html).not.toContain('Image blocked')
      expect(decodeHostImageSrc(srcOf(html))).toBe(path)
    }
  })

  it('decodes a percent-escaped destination once', async () => {
    expect(decodeHostImageSrc(srcOf(await render('![alt](./screen%20one.png)')))).toBe('./screen one.png')
  })

  it('resolves image references but leaves code alone', async () => {
    const html = await render('![shot][ref]\n\n[ref]: <out/screen one.png>\n\n`![code](out/no.png)`')
    expect(decodeHostImageSrc(srcOf(html))).toBe('out/screen one.png')
    expect(html).toContain('![code](out/no.png)')
  })

  it('leaves a public URL untouched and, like the desktop, does not admit inline data', async () => {
    expect(srcOf(await render('![alt](https://example.com/a.png)'))).toBe('https://example.com/a.png')
    const html = await render('![alt](data:image/png;base64,iVBORw0KGgo=)')
    expect(srcOf(html)).toBeNull()
    expect(html).not.toContain('host-file:')
  })
})
