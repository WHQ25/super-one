/**
 * Markdown for the part of a rendered reply (`.chat-md`, Streamdown output) a
 * selection covers. Walks the live DOM rather than a clone, so a list keeps its
 * real numbering and a code block its language. Text is not escaped: a copied
 * `snake_case` stays as written.
 */

const SKIP = new Set(['BUTTON', 'INPUT', 'SCRIPT', 'STYLE', 'svg', 'TEMPLATE'])

/** The first text a list item shows, where its marker sits. */
function firstText(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  })
  return walker.nextNode() as Text | null
}

/** The item's first text when the range spans its start, i.e. its marker. */
export function coversMarker(range: Range, li: Element): Text | null {
  const text = firstText(li)
  if (!text) return null
  const start = document.createRange()
  start.setStart(text, 0)
  const covered = range.compareBoundaryPoints(Range.START_TO_START, start) <= 0
    && range.compareBoundaryPoints(Range.START_TO_END, start) > 0
  return covered ? text : null
}

function isInline(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return true
  const el = node as Element
  if (el.classList.contains('katex-display')) return false
  return getComputedStyle(el).display.startsWith('inline')
}

/** Move a run's edge spaces outside its markers: `** a **` is not bold. */
function wrap(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
  return match[2] ? `${match[1]}${marker}${match[2]}${marker}${match[3]}` : text
}

function fenceFor(text: string, min: number): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length))
  return '`'.repeat(Math.max(min, longest + 1))
}

function tex(el: Element): string {
  return el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? ''
}

class Converter {
  constructor(private readonly range: Range) {}

  private hits(node: Node): boolean {
    return this.range.intersectsNode(node)
  }

  /** The selected part of a node's text. */
  private text(node: Node): string {
    const r = document.createRange()
    r.selectNodeContents(node)
    if (this.range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(this.range.startContainer, this.range.startOffset)
    if (this.range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(this.range.endContainer, this.range.endOffset)
    return r.toString()
  }

  private inlineChildren(el: Element): string {
    let out = ''
    el.childNodes.forEach((child) => {
      if (this.hits(child)) out += this.inline(child)
    })
    return out
  }

  inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return this.text(node)
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    if (SKIP.has(el.tagName) || el.getAttribute('aria-hidden') === 'true') return ''
    if (el.dataset.copyText !== undefined) return el.dataset.copyText
    if (el.classList.contains('katex')) return `$${tex(el)}$`
    const inner = (): string => this.inlineChildren(el)
    switch (el.tagName) {
      case 'BR': return '\n'
      case 'CODE': {
        const code = this.text(el)
        const fence = fenceFor(code, 1)
        return `${fence}${code}${fence}`
      }
      case 'STRONG':
      case 'B': return wrap(inner(), '**')
      case 'EM':
      case 'I': return wrap(inner(), '*')
      case 'DEL':
      case 'S': return wrap(inner(), '~~')
      case 'A': {
        const label = inner()
        const href = el.getAttribute('href')
        return href && label.trim() ? `[${label}](${href})` : label
      }
      case 'IMG': return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`
    }
    if (el.dataset.streamdown === 'strong') return wrap(inner(), '**')
    return inner()
  }

  /** A container's selected children as Markdown blocks; inline runs become paragraphs. */
  blocks(el: Element): string[] {
    const out: string[] = []
    let run = ''
    const flush = (): void => {
      if (run.trim()) out.push(run.trim())
      run = ''
    }
    el.childNodes.forEach((child) => {
      if (!this.hits(child)) return
      if (isInline(child)) run += this.inline(child)
      else {
        flush()
        out.push(...this.block(child as Element))
      }
    })
    flush()
    return out
  }

  block(el: Element): string[] {
    if (SKIP.has(el.tagName) || getComputedStyle(el).display === 'none') return []
    const heading = /^H([1-6])$/.exec(el.tagName)
    if (heading) return [`${'#'.repeat(Number(heading[1]))} ${this.inlineChildren(el).trim()}`]
    switch (el.tagName) {
      case 'P': return [this.inlineChildren(el).trim()]
      case 'UL':
      case 'OL': return [this.list(el)]
      case 'BLOCKQUOTE': return [this.blocks(el).join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')]
      case 'HR': return ['---']
      case 'PRE': return [this.fence(el, '')]
      case 'TABLE': return [this.table(el)]
    }
    if (el.matches('[data-chat-codeblock]')) {
      const language = el.querySelector(':scope > div:first-child > span')?.textContent?.trim().toLowerCase() ?? ''
      // A rendered diagram shows no code text: its source rides on the wrapper.
      const source = (el as HTMLElement).dataset.codeSource
      if (source !== undefined) return [this.fenced(source.replace(/\n$/, ''), language)]
      const pre = el.querySelector('pre')
      return pre ? [this.fence(pre, language)] : []
    }
    if (el.classList.contains('katex-display')) return [`$$\n${tex(el)}\n$$`]
    return this.blocks(el)
  }

  private fence(pre: Element, language: string): string {
    return this.fenced(this.text(pre).replace(/\n$/, ''), language)
  }

  private fenced(code: string, language: string): string {
    const fence = fenceFor(code, 3)
    return `${fence}${language}\n${code}\n${fence}`
  }

  private list(el: Element): string {
    const ordered = el.tagName === 'OL'
    const start = ordered ? (el as HTMLOListElement).start || 1 : 1
    const items: string[] = []
    Array.from(el.children).forEach((li, index) => {
      if (li.tagName !== 'LI' || !this.hits(li)) return
      const checkbox = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]')
      const body = `${checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : ''}${this.blocks(li).join('\n').trimStart()}`
      // An item the selection starts inside reads as a fragment, without its marker.
      if (!coversMarker(this.range, li)) {
        items.push(body)
        return
      }
      const marker = ordered ? `${start + index}.` : '-'
      const indent = ' '.repeat(marker.length + 1)
      items.push(`${marker} ${body.split('\n').map((line, i) => (i && line ? indent + line : line)).join('\n')}`)
    })
    return items.join('\n')
  }

  private table(table: Element): string {
    const cells = (row: Element): string[] => Array.from(row.children)
      .map((cell) => this.inlineCell(cell))
    // GFM needs a header row even when the selection skipped it.
    const header = table.querySelector('thead tr')
    const body = Array.from(table.querySelectorAll('tbody tr')).filter((row) => this.hits(row))
    const head = header ? Array.from(header.children).map((cell) => (cell.textContent ?? '').trim()) : cells(body.shift() ?? table)
    const line = (values: string[]): string => `| ${values.join(' | ')} |`
    // Streamdown writes a column's alignment as the header cell's inline text-align.
    const align = (cell: Element | undefined): string => {
      const value = (cell as HTMLElement | undefined)?.style.textAlign
      return value === 'center' ? ':---:' : value === 'right' ? '---:' : value === 'left' ? ':---' : '---'
    }
    const headerCells = header ? Array.from(header.children) : []
    return [line(head), line(head.map((_, i) => align(headerCells[i]))), ...body.map((row) => line(cells(row)))].join('\n')
  }

  private inlineCell(cell: Element): string {
    return (this.hits(cell) ? this.inlineChildren(cell) : '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
  }
}

/**
 * Markdown for a selection that touches a rendered reply, or null when it does
 * not, or when it stays inside code (copied raw, as written).
 */
export function markdownOfRange(range: Range): string | null {
  const common = range.commonAncestorContainer
  const scope = common instanceof Element ? common : common.parentElement
  if (!scope || scope.closest('pre, code')) return null
  const inReply = scope.closest('.chat-md') !== null
    || Array.from(scope.querySelectorAll('.chat-md')).some((reply) => range.intersectsNode(reply))
  if (!inReply) return null
  const converter = new Converter(range)
  const blocks = isInline(scope) ? [converter.inline(scope).trim()] : converter.block(scope)
  return blocks.filter(Boolean).join('\n\n')
}
