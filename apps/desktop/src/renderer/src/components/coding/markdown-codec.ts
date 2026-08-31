import { generateJSON } from '@tiptap/html'
import type { JSONContent } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkHtml from 'remark-html'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import { common, createLowlight } from 'lowlight'
import { Node } from '@tiptap/core'

const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/

export interface ParsedMarkdown {
  frontmatter: string | null
  body: string
}

export function splitFrontmatter(source: string): ParsedMarkdown {
  const m = source.match(FRONTMATTER_RE)
  if (!m) return { frontmatter: null, body: source }
  return { frontmatter: m[1], body: m[2] }
}

const codecLowlight = createLowlight(common)

const InlineMathSchema = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-type="inline-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, 'data-type': 'inline-math' }] },
})

const BlockMathSchema = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-type="block-math"]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'block-math' }] },
})

/** Ordered attribute map of an element, so serialization can replay it verbatim. */
function readAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) out[attr.name] = attr.value
  return out
}

/**
 * Markdown images (`![alt](src)`) — also how this app embeds video and audio,
 * which the editor's node view dispatches on by file extension. Without a node
 * in the schema `generateJSON` drops every `<img>`, so the preview rendered
 * nothing *and* the next autosave wrote the image out of the file.
 */
export const ImageSchema = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: null },
      title: { default: null },
    }
  },
  parseHTML() { return [{ tag: 'img[src]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', HTMLAttributes] },
})

/**
 * Raw `<video>` / `<audio>` written directly in the markdown. Parsed from the
 * DOM rather than from the mdast `html` node because the common single-line
 * form (`<video src="a.mp4"></video>`) is not a CommonMark HTML block — remark
 * splits it into separate open/close inline html nodes, and only the browser's
 * parser puts the element back together.
 *
 * Inline (like `image`) so both spellings round-trip: a tag on its own line is
 * a paragraph holding just this node, and a tag mid-sentence stays mid-sentence.
 * Attributes and `<source>` children are carried verbatim so serialization
 * gives the author's markup back instead of a normalized rewrite.
 */
export const RawMediaSchema = Node.create({
  name: 'rawMedia',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      tag: { default: 'video' },
      attrs: { default: {} },
      sources: { default: [] },
    }
  },
  parseHTML() {
    return (['video', 'audio'] as const).map((tag) => ({
      tag,
      getAttrs: (el: HTMLElement) => ({
        tag,
        attrs: readAttributes(el),
        sources: Array.from(el.querySelectorAll('source')).map(readAttributes),
      }),
    }))
  },
  renderHTML({ node }) {
    const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
    return [
      node.attrs.tag as string,
      { ...((node.attrs.attrs as Record<string, string>) ?? {}) },
      ...sources.map((source) => ['source', source] as const),
    ] as never
  },
})

const codecExtensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight: codecLowlight, defaultLanguage: 'plaintext' }),
  TableKit,
  InlineMathSchema,
  BlockMathSchema,
  ImageSchema,
  RawMediaSchema,
]

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkHtml, {
      sanitize: false,
      handlers: {
        inlineMath(_state: unknown, node: { value: string }) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { 'data-type': 'inline-math', 'data-latex': node.value },
            children: [{ type: 'text', value: node.value }],
          }
        },
        math(_state: unknown, node: { value: string }) {
          return {
            type: 'element',
            tagName: 'div',
            properties: { 'data-type': 'block-math', 'data-latex': node.value },
            children: [{ type: 'text', value: node.value }],
          }
        },
      },
    })
    .process(markdown)
  return String(result)
}

function frontmatterToHtml(frontmatter: string): string {
  const escaped = frontmatter
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<pre><code class="language-yaml">${escaped}</code></pre>`
}

export async function markdownToDoc(source: string): Promise<JSONContent> {
  const { frontmatter, body } = splitFrontmatter(source)
  const bodyHtml = body.trim() ? await markdownToHtml(body) : ''
  const fmHtml = frontmatter !== null ? frontmatterToHtml(frontmatter) : ''
  const html = fmHtml + bodyHtml || '<p></p>'
  return generateJSON(html, codecExtensions)
}

function serializeImage(node: ProseMirrorNode): string {
  const src = (node.attrs.src as string) || ''
  const alt = (node.attrs.alt as string) || ''
  const title = node.attrs.title as string | null
  return `![${alt}](${title ? `${src} "${title}"` : src})`
}

function serializeAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${value.replace(/"/g, '&quot;')}"`))
    .join('')
}

function serializeRawMedia(node: ProseMirrorNode): string {
  const tag = (node.attrs.tag as string) || 'video'
  const attrs = (node.attrs.attrs as Record<string, string>) ?? {}
  const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
  const inner = sources.map((source) => `<source${serializeAttributes(source)}>`).join('')
  return `<${tag}${serializeAttributes(attrs)}>${inner}</${tag}>`
}

function serializeInline(node: ProseMirrorNode): string {
  let text = ''
  node.forEach((child) => {
    if (child.isText) {
      let content = child.text || ''
      const marks = child.marks.slice().sort((a, b) => {
        const order = ['link', 'code', 'bold', 'italic', 'strike']
        return order.indexOf(a.type.name) - order.indexOf(b.type.name)
      })
      marks.forEach((mark) => {
        switch (mark.type.name) {
          case 'bold': content = `**${content}**`; break
          case 'italic': content = `*${content}*`; break
          case 'code': content = `\`${content}\``; break
          case 'strike': content = `~~${content}~~`; break
          case 'link': content = `[${content}](${mark.attrs.href || ''})`; break
        }
      })
      text += content
    } else if (child.type.name === 'hardBreak') {
      text += '  \n'
    } else if (child.type.name === 'inlineMath') {
      text += `$${(child.attrs.latex as string) || ''}$`
    } else if (child.type.name === 'image') {
      text += serializeImage(child)
    } else if (child.type.name === 'rawMedia') {
      text += serializeRawMedia(child)
    } else {
      text += serializeInline(child)
    }
  })
  return text
}

function processList(node: ProseMirrorNode, ordered: boolean, depth: number, lines: string[]): void {
  let index = 1
  node.forEach((item) => {
    if (item.type.name !== 'listItem') return
    const indent = '  '.repeat(depth)
    const prefix = ordered ? `${index}.` : '-'
    const first = item.firstChild
    const head = first ? serializeInline(first) : ''
    lines.push(`${indent}${prefix} ${head}`)
    index++
    item.forEach((child, _o, i) => {
      if (i === 0) return
      if (child.type.name === 'bulletList') processList(child, false, depth + 1, lines)
      else if (child.type.name === 'orderedList') processList(child, true, depth + 1, lines)
      else if (child.type.name === 'paragraph') lines.push(`${'  '.repeat(depth + 1)}${serializeInline(child)}`)
    })
  })
}

function processBlock(node: ProseMirrorNode, lines: string[]): void {
  switch (node.type.name) {
    case 'heading': {
      const level = node.attrs.level || 1
      lines.push(`${'#'.repeat(level)} ${serializeInline(node)}`)
      lines.push('')
      return
    }
    case 'paragraph': {
      lines.push(serializeInline(node))
      lines.push('')
      return
    }
    case 'codeBlock': {
      const lang = node.attrs.language || ''
      lines.push(`\`\`\`${lang}`)
      node.textContent.split('\n').forEach((l) => lines.push(l))
      lines.push('```')
      lines.push('')
      return
    }
    case 'bulletList': {
      processList(node, false, 0, lines)
      lines.push('')
      return
    }
    case 'orderedList': {
      processList(node, true, 0, lines)
      lines.push('')
      return
    }
    case 'blockquote': {
      const inner: string[] = []
      node.forEach((child) => processBlock(child, inner))
      while (inner.length && inner[inner.length - 1] === '') inner.pop()
      inner.forEach((l) => lines.push(l.length ? `> ${l}` : '>'))
      lines.push('')
      return
    }
    case 'horizontalRule': {
      lines.push('---')
      lines.push('')
      return
    }
    case 'mermaid': {
      const syntax = (node.attrs.syntax as string) || ''
      lines.push('```mermaid')
      syntax.split('\n').forEach((l) => lines.push(l))
      lines.push('```')
      lines.push('')
      return
    }
    case 'blockMath': {
      const latex = (node.attrs.latex as string) || ''
      lines.push('$$')
      latex.split('\n').forEach((l) => lines.push(l))
      lines.push('$$')
      lines.push('')
      return
    }
    case 'table': {
      const rows: string[][] = []
      node.forEach((row) => {
        if (row.type.name !== 'tableRow') return
        const cells: string[] = []
        row.forEach((cell) => {
          if (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader') {
            const cellText = cell.firstChild ? serializeInline(cell.firstChild) : ''
            cells.push(cellText.trim().replace(/\|/g, '\\|'))
          }
        })
        rows.push(cells)
      })
      if (rows.length === 0) return
      const cols = rows[0].length
      lines.push(`| ${rows[0].join(' | ')} |`)
      lines.push(`| ${Array(cols).fill('---').join(' | ')} |`)
      rows.slice(1).forEach((row) => lines.push(`| ${row.join(' | ')} |`))
      lines.push('')
      return
    }
    default: {
      if (node.isBlock && node.textContent) {
        lines.push(node.textContent)
        lines.push('')
      }
    }
  }
}

export function docToMarkdown(editor: Editor): string {
  const doc = editor.state.doc
  const lines: string[] = []
  let frontmatter: string | null = null
  let startIndex = 0
  const first = doc.firstChild
  if (first && first.type.name === 'codeBlock' && first.attrs.language === 'yaml') {
    frontmatter = first.textContent
    startIndex = 1
  }
  doc.forEach((child, _offset, index) => {
    if (index < startIndex) return
    processBlock(child, lines)
  })
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const body = lines.join('\n')
  if (frontmatter !== null) {
    const fm = `---\n${frontmatter}\n---\n`
    return body ? `${fm}\n${body}\n` : `${fm}`
  }
  return body ? `${body}\n` : ''
}
