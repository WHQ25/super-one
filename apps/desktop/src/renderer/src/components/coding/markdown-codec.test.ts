import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import { common, createLowlight } from 'lowlight'
import { docToMarkdown, ImageSchema, markdownToDoc, RawMediaSchema, splitFrontmatter } from './markdown-codec'

const lowlight = createLowlight(common)

const InlineMathStub = Node.create({
  name: 'inlineMath', group: 'inline', inline: true, atom: true,
  addAttributes() { return { latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '' } } },
  parseHTML() { return [{ tag: 'span[data-type="inline-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, 'data-type': 'inline-math' }] },
})
const BlockMathStub = Node.create({
  name: 'blockMath', group: 'block', atom: true,
  addAttributes() { return { latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '' } } },
  parseHTML() { return [{ tag: 'div[data-type="block-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'block-math' }] },
})
const MermaidStub = Node.create({
  name: 'mermaid', group: 'block', atom: true,
  addAttributes() { return { syntax: { default: '' }, isEditing: { default: false } } },
  parseHTML() { return [{ tag: 'div[data-type="mermaid"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'mermaid' }] },
})

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
  TableKit,
  InlineMathStub,
  BlockMathStub,
  MermaidStub,
  ImageSchema,
  RawMediaSchema,
]

async function roundTrip(input: string): Promise<string> {
  const json = await markdownToDoc(input)
  const editor = new Editor({ extensions, content: json })
  const out = docToMarkdown(editor as never)
  editor.destroy()
  return out
}

function normalize(s: string): string {
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trimEnd()
}

describe('splitFrontmatter', () => {
  it('parses yaml frontmatter', () => {
    const r = splitFrontmatter('---\ntitle: Hi\n---\n# Body')
    expect(r.frontmatter).toBe('title: Hi')
    expect(r.body).toBe('# Body')
  })

  it('returns null when no frontmatter', () => {
    expect(splitFrontmatter('# Title').frontmatter).toBeNull()
  })

  it('does not match mid-document hr', () => {
    expect(splitFrontmatter('# Title\n---\nfoo').frontmatter).toBeNull()
  })
})

describe('markdown round-trip', () => {
  it('preserves a heading', async () => {
    const md = '# Hello world\n'
    expect(normalize(await roundTrip(md))).toBe(normalize(md))
  })

  it('preserves paragraphs with inline marks', async () => {
    const md = 'A **bold** and *italic* and `code` in line.\n'
    const out = await roundTrip(md)
    expect(out).toContain('**bold**')
    expect(out).toContain('`code`')
    expect(out).toMatch(/\*italic\*|_italic_/)
  })

  it('preserves a fenced code block with language', async () => {
    const md = '```ts\nconst x = 1\n```\n'
    const out = await roundTrip(md)
    expect(out).toContain('```ts')
    expect(out).toContain('const x = 1')
    expect(out).toContain('```')
  })

  it('preserves bullet lists', async () => {
    const md = '- one\n- two\n- three\n'
    const out = await roundTrip(md)
    expect(out).toContain('- one')
    expect(out).toContain('- two')
    expect(out).toContain('- three')
  })

  it('preserves ordered lists', async () => {
    const md = '1. one\n2. two\n3. three\n'
    const out = await roundTrip(md)
    expect(out).toContain('1. one')
    expect(out).toContain('2. two')
  })

  it('preserves blockquotes', async () => {
    const md = '> quoted line\n'
    const out = await roundTrip(md)
    expect(out).toContain('> quoted line')
  })

  it('preserves a GFM table', async () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const out = await roundTrip(md)
    expect(out).toContain('| a | b |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| 1 | 2 |')
  })

  it('preserves links', async () => {
    const md = '[anthropic](https://anthropic.com)\n'
    const out = await roundTrip(md)
    expect(out).toContain('[anthropic](https://anthropic.com)')
  })

  it('preserves horizontal rule', async () => {
    const md = 'before\n\n---\n\nafter\n'
    const out = await roundTrip(md)
    expect(out).toContain('---')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })
})

describe('media round-trip', () => {
  it('preserves a relative image without rewriting its path', async () => {
    expect(await roundTrip('![a cat](./assets/cat.png)')).toBe('![a cat](./assets/cat.png)\n')
  })

  it('preserves a video embed written as an image', async () => {
    expect(await roundTrip('![demo](media/demo.mp4)')).toBe('![demo](media/demo.mp4)\n')
  })

  it('preserves an image with an empty alt and a remote url', async () => {
    expect(await roundTrip('![](https://example.com/a.png)')).toBe('![](https://example.com/a.png)\n')
  })

  it('preserves an image title', async () => {
    expect(await roundTrip('![a](b.png "caption")')).toBe('![a](b.png "caption")\n')
  })

  it('keeps an image that shares a paragraph with text', async () => {
    expect(await roundTrip('before ![a](b.png) after')).toBe('before ![a](b.png) after\n')
  })

  it('preserves a single-line raw video tag', async () => {
    const input = '<video src="media/demo.mp4" controls></video>'
    expect(await roundTrip(input)).toBe(`${input}\n`)
  })

  it('preserves a raw audio tag', async () => {
    const input = '<audio src="media/take.mp3" controls loop></audio>'
    expect(await roundTrip(input)).toBe(`${input}\n`)
  })

  it('preserves a raw video written as a multi-line html block', async () => {
    const out = await roundTrip('<video controls>\n</video>')
    expect(out).toBe('<video controls></video>\n')
  })

  it('preserves source children of a raw video', async () => {
    const out = await roundTrip('<video controls><source src="a.webm" type="video/webm"><source src="a.mp4" type="video/mp4"></video>')
    expect(out).toBe('<video controls><source src="a.webm" type="video/webm"><source src="a.mp4" type="video/mp4"></video>\n')
  })

  it('keeps a raw video that shares a paragraph with text', async () => {
    const input = 'before <video src="a.mp4"></video> after'
    expect(await roundTrip(input)).toBe(`${input}\n`)
  })

  it('is idempotent across a second round-trip', async () => {
    const once = await roundTrip('<video controls>\n  <source src="a.mp4" type="video/mp4">\n</video>')
    expect(await roundTrip(once)).toBe(once)
  })
})

describe('frontmatter round-trip', () => {
  it('keeps frontmatter as the first code block on save', async () => {
    const md = '---\ntitle: Hello\ntags: [a, b]\n---\n# Body\n'
    const out = await roundTrip(md)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('title: Hello')
    expect(out).toContain('tags: [a, b]')
    expect(out).toContain('# Body')
  })

  it('emits no frontmatter when the source had none', async () => {
    const md = '# Just body\n'
    const out = await roundTrip(md)
    expect(out.startsWith('---')).toBe(false)
    expect(out).toContain('# Just body')
  })
})

describe('docs/test/markdown-formats fixture', () => {
  const fixturePath = resolve(__dirname, '../../../../../../../docs/test/markdown-formats.md')
  const fixture = readFileSync(fixturePath, 'utf8')

  it('preserves frontmatter on round-trip', async () => {
    const out = await roundTrip(fixture)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('title: Markdown Editor Coverage Fixture')
    expect(out).toContain('tags: [test, markdown, wysiwyg]')
  })

  it('preserves all heading levels', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/^# H1/m)
    expect(out).toMatch(/^## H2/m)
    expect(out).toMatch(/^### H3/m)
    expect(out).toMatch(/^#### H4/m)
    expect(out).toMatch(/^##### H5/m)
    expect(out).toMatch(/^###### H6/m)
  })

  it('preserves inline marks (bold/italic/strike/code/link)', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/\*\*Bold text\*\*/)
    expect(out).toMatch(/~~Strikethrough~~/)
    expect(out).toContain('`inline code`')
    expect(out).toContain('[normal link](https://anthropic.com)')
  })

  it('preserves bullet, ordered, and nested lists', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('- First item')
    expect(out).toMatch(/1\. Step one/)
    expect(out).toContain('  - Nested level 2')
  })

  it('preserves multiple code blocks with language tags', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('```ts')
    expect(out).toContain('```python')
    expect(out).toContain('```yaml')
    expect(out).toContain('```json')
  })

  it('preserves GFM tables with header and rows', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/\|\s*Feature\s*\|/)
    expect(out).toMatch(/\|\s*---+\s*\|/)
    expect(out).toContain('Headings')
    expect(out).toContain('Mermaid')
  })

  it('preserves blockquotes including nested form', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/^> Single-line blockquote/m)
    expect(out).toMatch(/^> > Inner quote/m)
  })

  it('preserves image and video embeds', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('![a relative image](assets/cat.png)')
    expect(out).toContain('![a video embed](media/demo.mp4)')
    expect(out).toContain('![](https://example.com/remote.png)')
  })

  it('preserves raw video and audio tags', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('<video src="media/demo.mp4" controls></video>')
    expect(out).toContain('<audio src="media/take.mp3" controls loop></audio>')
    expect(out).toContain('<video controls><source src="media/demo.webm" type="video/webm"><source src="media/demo.mp4" type="video/mp4"></video>')
  })

  it('preserves images embedded inside list items', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('- Empty alt image (decorative): ![](assets/decorative.png)')
    expect(out).toContain('- Image with alt + title: ![alt text](assets/logo.png "Logo title")')
  })

  it('preserves horizontal rule', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/^---$/m)
  })

  it('keeps the mermaid block as a fenced code block (round-trips as plain code)', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('```mermaid')
    expect(out).toContain('flowchart LR')
  })

  it('preserves inline math via $...$ syntax', async () => {
    const out = await roundTrip(fixture)
    expect(out).toContain('$E = mc^2$')
    expect(out).toContain('$a^2 + b^2 = c^2$')
  })

  it('preserves display math via $$...$$ blocks', async () => {
    const out = await roundTrip(fixture)
    expect(out).toMatch(/\$\$\n[^\n]*\\int_0\^\\infty/)
    expect(out).toContain('\\frac{\\sqrt{\\pi}}{2}')
  })
})

describe('mermaid / math node serialization', () => {
  it('serializes a mermaid node back to a ```mermaid fence', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'mermaid', attrs: { syntax: 'flowchart LR\n  A --> B', isEditing: false } },
      ],
    }
    const editor = new Editor({ extensions, content: doc })
    const out = docToMarkdown(editor as never)
    editor.destroy()
    expect(out).toContain('```mermaid')
    expect(out).toContain('flowchart LR')
    expect(out).toContain('  A --> B')
    expect(out).toContain('```')
  })

  it('serializes a blockMath node back to $$...$$ block', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
      ],
    }
    const editor = new Editor({ extensions, content: doc })
    const out = docToMarkdown(editor as never)
    editor.destroy()
    expect(out).toMatch(/\$\$\nE = mc\^2\n\$\$/)
  })

  it('serializes an inlineMath node inside a paragraph as $latex$', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'When ' },
            { type: 'inlineMath', attrs: { latex: 'x > 0' } },
            { type: 'text', text: ' the value is positive.' },
          ],
        },
      ],
    }
    const editor = new Editor({ extensions, content: doc })
    const out = docToMarkdown(editor as never)
    editor.destroy()
    expect(out).toContain('When $x > 0$ the value is positive.')
  })
})
