import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkHtml from 'remark-html'

export const LARGE_MARKDOWN_CHAR_THRESHOLD = 24_000
const DEFAULT_FIRST_CHUNK_LINES = 150
const DEFAULT_CHUNK_LINES = 350

const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g
const REF_DEF_RE = /^ {0,3}\[[^\]]+\]:/m
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const HTML_VOID_OR_SELF_CLOSING_RE = /\/\s*>$/
const HTML_CONTAINER_TAGS = new Set([
  'details',
  'table',
  'div',
  'section',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
  'main',
  'figure',
  'blockquote',
  'pre',
  'video',
  'audio',
  'picture',
  'svg',
  'script',
  'style',
  'ul',
  'ol',
  'dl',
])
const HTML_TAG_TOKEN_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?\/?>/g
const LIST_ITEM_START_RE = /^ {0,3}(?:[-*+]|\d+[.)])\s/

const remarkHtmlOptions = {
  sanitize: false,
  handlers: {
    footnoteReference(_state: unknown, node: { identifier: string; label?: string }) {
      return {
        type: 'element' as const,
        tagName: 'span',
        properties: { 'data-type': 'footnote-ref', 'data-label': node.label ?? node.identifier },
        children: [],
      }
    },
    footnoteDefinition(state: unknown, node: { identifier: string; label?: string }) {
      const all = (state as { all: (n: unknown) => never[] }).all
      return {
        type: 'element' as const,
        tagName: 'div',
        properties: { 'data-type': 'footnote-def', 'data-label': node.label ?? node.identifier },
        children: all(node),
      }
    },
    inlineMath(_state: unknown, node: { value: string }) {
      return {
        type: 'element' as const,
        tagName: 'span',
        properties: { 'data-type': 'inline-math', 'data-latex': node.value },
        children: [{ type: 'text' as const, value: node.value }],
      }
    },
    math(_state: unknown, node: { value: string }) {
      return {
        type: 'element' as const,
        tagName: 'div',
        properties: { 'data-type': 'block-math', 'data-latex': node.value },
        children: [{ type: 'text' as const, value: node.value }],
      }
    },
  },
} as never

let baseProcessor: ReturnType<typeof remark> | null = null
let mathProcessor: ReturnType<typeof remark> | null = null

function getBaseProcessor() {
  if (!baseProcessor) {
    baseProcessor = remark().use(remarkGfm).use(remarkHtml, remarkHtmlOptions).freeze()
  }
  return baseProcessor
}

function getMathProcessor() {
  if (!mathProcessor) {
    mathProcessor = remark().use(remarkGfm).use(remarkMath).use(remarkHtml, remarkHtmlOptions).freeze()
  }
  return mathProcessor
}

export function replaceHtmlComments(html: string): string {
  if (!html.includes('-->')) return html
  const withMarkers = html.replace(HTML_COMMENT_RE, (_, value: string) => {
    const encoded = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    return `<div data-type="html-comment" data-value="${encoded}"></div>`
  })
  return withMarkers.replace(/-->/g, '--&gt;')
}

export function frontmatterToHtml(frontmatter: string): string {
  const escaped = frontmatter
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<pre><code class="language-yaml">${escaped}</code></pre>`
}

export async function markdownToHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return ''
  const processor = markdown.includes('$') ? getMathProcessor() : getBaseProcessor()
  const result = await processor.process(markdown)
  return replaceHtmlComments(String(result))
}

export function hasReferenceDefinitions(markdown: string): boolean {
  return REF_DEF_RE.test(markdown)
}

const INLINE_CODE_SPAN_RE = /`[^`]*`/g

function updateHtmlDepth(line: string, depth: number): number {
  if (!line.includes('<')) return depth
  const stripped = line.includes('`') ? line.replace(INLINE_CODE_SPAN_RE, '') : line
  if (!stripped.includes('<')) return depth
  let next = depth
  HTML_TAG_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HTML_TAG_TOKEN_RE.exec(stripped)) !== null) {
    const token = match[0]
    const tag = match[1].toLowerCase()
    if (!HTML_CONTAINER_TAGS.has(tag)) continue
    if (token.startsWith('</')) {
      next = Math.max(0, next - 1)
    } else if (!HTML_VOID_OR_SELF_CLOSING_RE.test(token)) {
      next += 1
    }
  }
  return next
}

function nextNonBlankLine(lines: string[], start: number): string | null {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim().length > 0) return lines[i]
  }
  return null
}

function isFenceClose(line: string, fenceChar: string, fenceLen: number): boolean {
  let i = 0
  while (i < 3 && i < line.length && line[i] === ' ') i++
  let count = 0
  while (i < line.length && line[i] === fenceChar) {
    count++
    i++
  }
  if (count < fenceLen) return false
  while (i < line.length) {
    if (line[i] !== ' ' && line[i] !== '\t' && line[i] !== '\r') return false
    i++
  }
  return true
}

export function splitMarkdownChunks(
  body: string,
  firstChunkLines = DEFAULT_FIRST_CHUNK_LINES,
  chunkLines = DEFAULT_CHUNK_LINES,
): string[] | null {
  if (body.length < LARGE_MARKDOWN_CHAR_THRESHOLD) return null
  if (hasReferenceDefinitions(body)) return null

  const lines = body.split('\n')
  if (lines.length <= firstChunkLines + 50) return null

  const chunks: string[] = []
  let chunkStart = 0
  let targetSize = firstChunkLines
  let fenceChar: string | null = null
  let fenceLen = 0
  let inMath = false
  let inHtmlComment = false
  let htmlDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (fenceChar) {
      if (isFenceClose(line, fenceChar, fenceLen)) {
        fenceChar = null
        fenceLen = 0
      }
      continue
    }

    if (inHtmlComment) {
      if (line.includes('-->')) inHtmlComment = false
      continue
    }

    if (inMath) {
      if (trimmed === '$$') inMath = false
      continue
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (marker[0] !== '`' || !line.slice(fenceMatch[0].length).includes('`')) {
        fenceChar = marker[0]
        fenceLen = marker.length
        continue
      }
    }

    if (trimmed === '$$') {
      inMath = true
      continue
    }

    if (line.includes('<!--') && !line.includes('-->')) {
      inHtmlComment = true
      continue
    }

    htmlDepth = updateHtmlDepth(line, htmlDepth)

    if (htmlDepth === 0 && trimmed === '' && i - chunkStart >= targetSize) {
      const upcoming = nextNonBlankLine(lines, i + 1)
      if (!upcoming) continue
      const isIndented = upcoming.startsWith('  ') || upcoming.startsWith('\t')
      const isListContinuation = LIST_ITEM_START_RE.test(upcoming) && i - chunkStart < targetSize + 80
      if (isIndented || isListContinuation) continue

      const slice = lines.slice(chunkStart, i).join('\n')
      if (slice.trim().length > 0) chunks.push(slice)
      chunkStart = i + 1
      targetSize = chunkLines
    }
  }

  if (chunkStart < lines.length) {
    const tail = lines.slice(chunkStart).join('\n')
    if (tail.trim().length > 0) chunks.push(tail)
  }

  return chunks.length > 1 ? chunks : null
}
