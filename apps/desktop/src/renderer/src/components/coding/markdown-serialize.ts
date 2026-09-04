import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

/**
 * Tiptap doc → markdown. The inverse (`markdownToDoc`) lives in
 * `markdown-codec.ts` alongside the schemas both halves share; keeping the two
 * directions in one file pushed it past the size where either stayed readable.
 */
function serializeImage(node: ProseMirrorNode, mode: InlineMode = 'markdown'): string {
  const src = (node.attrs.src as string) || ''
  const alt = (node.attrs.alt as string) || ''
  const title = node.attrs.title as string | null
  const width = node.attrs.width as string | null
  const height = node.attrs.height as string | null
  // Markdown has no syntax for dimensions, so an authored size can only go back
  // out as the HTML tag it came in as. Falling through to `![…](…)` here is how
  // a README's inline icons lose their `width` on the first autosave.
  if (mode === 'html' || width != null || height != null) {
    const attrs: Record<string, string> = { src }
    // An explicit `alt=""` marks the image decorative; dropping it because the
    // string is falsy makes a screen reader read the filename out instead.
    if (node.attrs.alt != null) attrs.alt = alt
    if (title) attrs.title = title
    if (width != null) attrs.width = String(width)
    if (height != null) attrs.height = String(height)
    return `<img${serializeAttributes(attrs, false)}>`
  }
  return `![${alt}](${title ? `${src} "${title}"` : src})`
}

/**
 * `bareEmpty` replays `<video controls>` as the author wrote it — a value-less
 * attribute. It is off for `<img alt="">`, where the empty string is the value
 * and not a boolean flag.
 */
function serializeAttributes(attrs: Record<string, string>, bareEmpty = true): string {
  return Object.entries(attrs)
    .map(([name, value]) =>
      value === '' && bareEmpty ? ` ${name}` : ` ${name}="${value.replace(/"/g, '&quot;')}"`,
    )
    .join('')
}

function serializeRawMedia(node: ProseMirrorNode): string {
  const tag = (node.attrs.tag as string) || 'video'
  const attrs = (node.attrs.attrs as Record<string, string>) ?? {}
  const sources = (node.attrs.sources as Array<Record<string, string>>) ?? []
  const fallback = node.attrs.fallback as Record<string, string> | null
  const inner =
    sources.map((source) => `<source${serializeAttributes(source)}>`).join('') +
    (fallback ? `<img${serializeAttributes(fallback, false)}>` : '')
  return `<${tag}${serializeAttributes(attrs)}>${inner}</${tag}>`
}

/**
 * `markdown` writes `**bold**`; `html` writes `<strong>`. The second exists
 * because a block that has to go out as raw HTML — an aligned paragraph — is an
 * HTML *block* to CommonMark, and markdown inside one is never parsed. Emitting
 * `<p align="center">**x**</p>` would ship literal asterisks to GitHub.
 */
type InlineMode = 'markdown' | 'html'

/** Marks with no markdown spelling: always written as the tag they came from. */
const HTML_MARK_TAGS: Record<string, string> = {
  kbd: 'kbd',
  abbr: 'abbr',
  sub: 'sub',
  sup: 'sup',
  small: 'small',
  ins: 'ins',
  mark: 'mark',
  underline: 'u',
}

/** Innermost first: `<kbd>` sits inside its link, emphasis wraps the lot. */
const MARK_ORDER = [
  ...Object.keys(HTML_MARK_TAGS),
  'link',
  'code',
  'bold',
  'italic',
  'strike',
]

function markDepth(mark: ProseMirrorMark): number {
  return MARK_ORDER.indexOf(mark.type.name)
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function wrapMark(content: string, mark: ProseMirrorMark, mode: InlineMode): string {
  const href = (mark.attrs.href as string) || ''
  const htmlTag = HTML_MARK_TAGS[mark.type.name]
  // These are HTML in both modes — markdown has nothing else to spell them with.
  if (htmlTag) {
    const title = mark.attrs.title as string | null
    return `<${htmlTag}${title ? serializeAttributes({ title }, false) : ''}>${content}</${htmlTag}>`
  }
  if (mode === 'html') {
    switch (mark.type.name) {
      case 'link': return `<a href="${href}">${content}</a>`
      case 'code': return `<code>${content}</code>`
      case 'bold': return `<strong>${content}</strong>`
      case 'italic': return `<em>${content}</em>`
      case 'strike': return `<del>${content}</del>`
      default: return content
    }
  }
  switch (mark.type.name) {
    case 'link': return `[${content}](${href})`
    case 'code': return `\`${content}\``
    case 'bold': return `**${content}**`
    case 'italic': return `*${content}*`
    case 'strike': return `~~${content}~~`
    default: return content
  }
}

/** A single inline node's own text, with its marks left to the caller. */
function serializeInlineLeaf(node: ProseMirrorNode, mode: InlineMode): string {
  if (node.isText) {
    const raw = node.text || ''
    return mode === 'html' ? escapeHtmlText(raw) : raw
  }
  switch (node.type.name) {
    case 'hardBreak': return mode === 'html' ? '<br />' : '  \n'
    case 'inlineMath': return `$${(node.attrs.latex as string) || ''}$`
    case 'footnoteRef': return `[^${node.attrs.label as string}]`
    case 'anchorTarget': return `<a name="${node.attrs.name as string}"></a>`
    case 'image': return serializeImage(node, mode)
    case 'rawMedia': return serializeRawMedia(node)
    default: return serializeInlineRun(node.children, [], mode)
  }
}

/** Marks on `node` that the enclosing run has not already opened. */
function pendingMarks(node: ProseMirrorNode, open: readonly ProseMirrorMark[]): ProseMirrorMark[] {
  return node.marks.filter((mark) => markDepth(mark) >= 0 && !open.some((o) => o.eq(mark)))
}

/** Index one past the last sibling from `start` that still carries `mark`. */
function runEnd(children: readonly ProseMirrorNode[], start: number, mark: ProseMirrorMark): number {
  let end = start + 1
  while (end < children.length && children[end].marks.some((m) => m.eq(mark))) end += 1
  return end
}

/**
 * Write a run of sibling inline nodes, opening each mark once around the longest
 * stretch of siblings that carries it. `open` is what the enclosing calls have
 * already opened, so recursion peels one layer at a time.
 *
 * A ProseMirror node holds a flat SET of marks with no nesting order, so the
 * order has to be recovered: the mark reaching furthest goes outside, and a
 * shorter one nests within it. Ranking by mark type alone is what turned
 * `**bold _and italic_**` into `**bold *****and italic***` — italic outranked
 * bold, so bold got closed and reopened in the middle of the emphasis. Ties (two
 * marks over the same nodes) fall back to `MARK_ORDER`, which is why a `<kbd>`
 * lands inside its link rather than around it.
 */
function serializeInlineRun(
  children: readonly ProseMirrorNode[],
  open: readonly ProseMirrorMark[],
  mode: InlineMode,
): string {
  let out = ''
  let i = 0
  while (i < children.length) {
    const candidates = pendingMarks(children[i], open)
    if (candidates.length === 0) {
      out += serializeInlineLeaf(children[i], mode)
      i += 1
      continue
    }
    let best = candidates[0]
    let bestEnd = runEnd(children, i, best)
    for (const mark of candidates.slice(1)) {
      const end = runEnd(children, i, mark)
      if (end > bestEnd || (end === bestEnd && markDepth(mark) > markDepth(best))) {
        best = mark
        bestEnd = end
      }
    }
    out += wrapMark(serializeInlineRun(children.slice(i, bestEnd), [...open, best], mode), best, mode)
    i = bestEnd
  }
  return out
}

function serializeInline(node: ProseMirrorNode, mode: InlineMode = 'markdown'): string {
  return serializeInlineRun(node.children, [], mode)
}

function processList(node: ProseMirrorNode, ordered: boolean, depth: number, lines: string[]): void {
  let index = 1
  node.forEach((item) => {
    if (item.type.name !== 'listItem') return
    const indent = '  '.repeat(depth)
    const checked = item.attrs.checked as boolean | null
    const prefix = `${ordered ? `${index}.` : '-'}${checked == null ? '' : checked ? ' [x]' : ' [ ]'}`
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

const CELL_ATTRS = ['width', 'valign', 'align', 'colspan', 'rowspan'] as const

/**
 * A GFM row is one line of inline markdown per cell. A cell holding a heading, a
 * list, or two paragraphs — which is how a README builds a feature wall — cannot
 * be expressed that way, and flattening it silently deletes the layout. Such a
 * table has to go back out as HTML. Presentation attributes count too: `width`
 * is usually the only thing holding the columns apart.
 */
function needsHtmlTable(node: ProseMirrorNode): boolean {
  let html = false
  node.descendants((child) => {
    if (html) return false
    if (child.type.name !== 'tableCell' && child.type.name !== 'tableHeader') return true
    if (CELL_ATTRS.some((name) => child.attrs[name] != null && child.attrs[name] !== 1)) html = true
    if (child.childCount > 1) html = true
    if (child.firstChild && child.firstChild.type.name !== 'paragraph') html = true
    return false
  })
  return html
}

function cellAttrs(cell: ProseMirrorNode): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of CELL_ATTRS) {
    const value = cell.attrs[name]
    if (value != null && value !== 1) out[name] = String(value)
  }
  return out
}

/**
 * Blank lines inside `<td>` are what let GitHub parse the cell body as markdown
 * again, so the body is written as markdown rather than in html inline mode.
 */
function processHtmlTable(node: ProseMirrorNode, lines: string[]): void {
  lines.push('<table>')
  node.forEach((row) => {
    if (row.type.name !== 'tableRow') return
    lines.push('<tr>')
    row.forEach((cell) => {
      if (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader') return
      const tag = cell.type.name === 'tableHeader' ? 'th' : 'td'
      lines.push(`<${tag}${serializeAttributes(cellAttrs(cell), false)}>`)
      lines.push('')
      const body: string[] = []
      cell.forEach((child) => processBlock(child, body))
      while (body.length && body[body.length - 1] === '') body.pop()
      body.forEach((line) => lines.push(line))
      lines.push('')
      lines.push(`</${tag}>`)
    })
    lines.push('</tr>')
  })
  lines.push('</table>')
  lines.push('')
}

function processBlock(node: ProseMirrorNode, lines: string[]): void {
  switch (node.type.name) {
    case 'heading': {
      const level = node.attrs.level || 1
      const align = node.attrs.align as string | null
      // An aligned block has to go back out as the HTML tag it came in as, and
      // that makes its contents an HTML block — hence the html inline mode.
      lines.push(
        align
          ? `<h${level} align="${align}">${serializeInline(node, 'html')}</h${level}>`
          : `${'#'.repeat(level)} ${serializeInline(node)}`,
      )
      lines.push('')
      return
    }
    case 'paragraph': {
      const align = node.attrs.align as string | null
      lines.push(align ? `<p align="${align}">${serializeInline(node, 'html')}</p>` : serializeInline(node))
      lines.push('')
      return
    }
    case 'codeBlock': {
      const lang = node.attrs.language || ''
      lines.push(`\`\`\`${lang}`)
      // The fence's own closing newline arrives as content (remark renders
      // `<code>…\n</code>`), so keeping it appends a blank line to every code
      // block on every save — they accumulate.
      node.textContent.replace(/\n$/, '').split('\n').forEach((l) => lines.push(l))
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
    case 'details': {
      const summary = node.firstChild
      // Blank lines around the body are load-bearing: an HTML block ends at the
      // first blank line, and only after it does CommonMark parse markdown again.
      lines.push(`<details${node.attrs.open ? ' open' : ''}>`)
      lines.push(`<summary>${summary ? serializeInline(summary, 'html') : ''}</summary>`)
      lines.push('')
      node.forEach((child, _offset, index) => {
        if (index === 0) return
        processBlock(child, lines)
      })
      while (lines.length && lines[lines.length - 1] === '') lines.pop()
      lines.push('')
      lines.push('</details>')
      lines.push('')
      return
    }
    case 'footnoteDef': {
      const body: string[] = []
      node.forEach((child) => processBlock(child, body))
      while (body.length && body[body.length - 1] === '') body.pop()
      // Continuation lines of a footnote are indented four spaces; the first one
      // rides on the marker.
      lines.push(`[^${node.attrs.label as string}]: ${body[0] ?? ''}`)
      body.slice(1).forEach((line) => lines.push(line.length ? `    ${line}` : ''))
      lines.push('')
      return
    }
    case 'htmlComment': {
      lines.push(`<!--${node.attrs.value as string}-->`)
      lines.push('')
      return
    }
    case 'table': {
      if (needsHtmlTable(node)) {
        processHtmlTable(node, lines)
        return
      }
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
