/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import type { Root } from 'hast'
import { visit } from 'unist-util-visit'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import { streamdownComponents, streamdownRehypePlugins } from './chat-shared'
import { remarkMediaPaths } from './remark-media-paths'

vi.mock('./markdown-image', () => ({ MarkdownImage: (props: Record<string, unknown>) => createElement('img', props) }))
vi.mock('./CodeBlock', () => ({ createStreamdownCodeComponent: () => ({}) }))
vi.mock('@streamdown/code', () => ({ createCodePlugin: () => ({}) }))

async function sources(markdown: string, project = '/projects/app'): Promise<string[]> {
  const processor = unified().use(remarkParse).use(remarkMediaPaths(project)).use(remarkRehype)
  const tree = await processor.run(processor.parse(markdown)) as Root
  const result: string[] = []
  visit(tree, 'element', (node) => {
    if (node.tagName === 'img') result.push(String(node.properties.src))
  })
  return result
}

describe('chat Markdown media destinations', () => {
  it.each(['png', 'mp4', 'mp3'])('resolves an angle-bracket %s capture without treating it as project-relative', async (ext) => {
    expect(await sources(`![capture](</var/folders/captures/screen.${ext}>)`))
      .toEqual([`local-file:///var/folders/captures/screen.${ext}`])
  })

  it('supports spaces, Unicode, parentheses and literal percent/hash characters', async () => {
    expect(await sources('![capture](<./截图 (1) 100%#.png>)'))
      .toEqual(['local-file:///projects/app/%E6%88%AA%E5%9B%BE%20(1)%20100%25%23.png'])
    expect(await sources('![capture](./screen%20one.png)'))
      .toEqual(['local-file:///projects/app/screen%20one.png'])
  })

  it('resolves image references while leaving code examples and qualified URLs alone', async () => {
    expect(await sources('![capture][shot]\n\n[shot]: <./screen one.png>\n\n`![code](./no.png)`\n\n```md\n![code](./no.png)\n```'))
      .toEqual(['local-file:///projects/app/screen%20one.png'])
    expect(await sources('![capture](local-file:///tmp/screen%20one.png)'))
      .toEqual(['local-file:///tmp/screen%20one.png'])
  })

  it('routes remote project media through the remote file transport', async () => {
    const [src] = await sources('![capture](</home/me/app/screen one.png>)', 'remote:node:/home/me/app')
    expect(src).toMatch(/^remote-media:\/\/ref\//)
  })
  it.each([['png', 'img'], ['mp4', 'video'], ['mp3', 'audio']])('renders %s as a %s in the actual chat Markdown pipeline', (ext, tag) => {
    const html = renderToStaticMarkup(createElement(Streamdown, {
      remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkMediaPaths('/projects/app')],
      rehypePlugins: streamdownRehypePlugins,
      components: streamdownComponents,
      children: `![capture](</projects/app/screen one.${ext}>)`,
    }))
    expect(html).toContain(`<${tag}`)
    expect(html).toContain(`screen%20one.${ext}`)
    if (tag !== 'img') expect(html).toContain('controls')
  })

})
