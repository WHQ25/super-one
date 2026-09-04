import { generateJSON } from '@tiptap/html'
import type { JSONContent } from '@tiptap/react'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkHtml from 'remark-html'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import { common, createLowlight } from 'lowlight'
import { BlockMathSchema, htmlSchemas, ImageSchema, InlineMathSchema, RawMediaSchema } from './markdown-schemas'

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

const codecExtensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight: codecLowlight, defaultLanguage: 'plaintext' }),
  TableKit,
  InlineMathSchema,
  BlockMathSchema,
  ImageSchema,
  RawMediaSchema,
  ...htmlSchemas,
]

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkHtml, {
      sanitize: false,
      handlers: {
        // Stop mdast-util-to-hast from expanding footnotes into superscript
        // anchors plus a generated "Footnotes" section — see FootnoteRefSchema.
        footnoteReference(_state: unknown, node: { identifier: string; label?: string }) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { 'data-type': 'footnote-ref', 'data-label': node.label ?? node.identifier },
            children: [],
          }
        },
        footnoteDefinition(state: unknown, node: { identifier: string; label?: string }) {
          // `state.all` is how a handler recurses into its own children; the
          // signature is loose here to match the neighbouring handlers, which
          // remark-html's own option type will not otherwise accept.
          const all = (state as { all: (n: unknown) => never[] }).all
          return {
            type: 'element',
            tagName: 'div',
            properties: { 'data-type': 'footnote-def', 'data-label': node.label ?? node.identifier },
            children: all(node),
          }
        },
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
  return replaceHtmlComments(String(result))
}

const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g

/**
 * Swap comments for an element the DOM parser will actually hand to ProseMirror
 * — it skips comment nodes entirely, so this is the only way one survives.
 * Safe to run over the whole document: remark escapes `<` inside code blocks, so
 * a comment written *in* a fence is already `&#x3C;!--` by the time we get here.
 */
function replaceHtmlComments(html: string): string {
  const withMarkers = html.replace(HTML_COMMENT_RE, (_, value: string) => {
    const encoded = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    return `<div data-type="html-comment" data-value="${encoded}"></div>`
  })
  // Whatever `-->` is left is text, not a comment terminator — and @tiptap/html
  // duplicates the surrounding text when it parses a bare one (`a --> b` comes
  // back as `a a --> b`). remark escapes the `<` in a code fence but not the
  // `>`, so a JS comment or a Rust arrow inside a fence hits this. Neutralize it
  // after the real comments are already out of the way.
  return withMarkers.replace(/-->/g, '--&gt;')
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
