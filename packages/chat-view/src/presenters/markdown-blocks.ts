const REF_OR_FOOTNOTE_RE = /^ {0,3}\[[^\]]+\]:|\[\^[^\]]+\]/m
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/
const ORDERED_LIST_RE = /^ {0,3}\d+[.)]\s/
const HTML_TAG_TOKEN_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?\/?>/g
const HTML_SELF_CLOSING_RE = /\/\s*>$/
const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

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

const INLINE_CODE_SPAN_RE = /`[^`]*`/g

function updateHtmlStack(line: string, stack: string[]): void {
  if (!line.includes('<')) return
  const stripped = line.includes('`') ? line.replace(INLINE_CODE_SPAN_RE, '') : line
  if (!stripped.includes('<')) return
  HTML_TAG_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HTML_TAG_TOKEN_RE.exec(stripped)) !== null) {
    const token = match[0]
    const tag = match[1].toLowerCase()
    if (HTML_VOID_TAGS.has(tag)) continue
    if (token.startsWith('</')) {
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j] === tag) {
          stack.length = j
          break
        }
      }
    } else if (!HTML_SELF_CLOSING_RE.test(token)) {
      stack.push(tag)
    }
  }
}

function nextNonBlank(lines: string[], start: number): string | null {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim().length > 0) return lines[i]
  }
  return null
}

export function parseMarkdownBlocksFast(markdown: string): string[] {
  if (!markdown) return []
  if (REF_OR_FOOTNOTE_RE.test(markdown)) return [markdown]

  const lines = markdown.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fenceChar: string | null = null
  let fenceLen = 0
  let inMath = false
  let inHtmlComment = false
  const htmlStack: string[] = []

  const flush = () => {
    if (current.length === 0) return
    const text = current.join('\n')
    if (text.trim().length > 0) blocks.push(text)
    current = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (fenceChar) {
      current.push(line)
      if (isFenceClose(line, fenceChar, fenceLen)) {
        fenceChar = null
        fenceLen = 0
      }
      continue
    }

    if (inHtmlComment) {
      current.push(line)
      if (line.includes('-->')) inHtmlComment = false
      continue
    }

    if (inMath) {
      current.push(line)
      if (trimmed === '$$') inMath = false
      continue
    }

    if (htmlStack.length > 0) {
      current.push(line)
      updateHtmlStack(line, htmlStack)
      continue
    }

    if (trimmed === '') {
      if (current.length === 0) continue
      const upcoming = nextNonBlank(lines, i + 1)
      if (upcoming && (upcoming.startsWith('  ') || upcoming.startsWith('\t'))) {
        current.push(line)
        continue
      }
      if (upcoming && ORDERED_LIST_RE.test(upcoming) && current.some((l) => ORDERED_LIST_RE.test(l))) {
        current.push(line)
        continue
      }
      flush()
      continue
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (marker[0] !== '`' || !line.slice(fenceMatch[0].length).includes('`')) {
        flush()
        fenceChar = marker[0]
        fenceLen = marker.length
        current.push(line)
        continue
      }
    }

    if (trimmed === '$$') {
      flush()
      inMath = true
      current.push(line)
      continue
    }

    if (line.includes('<!--') && !line.includes('-->')) {
      flush()
      inHtmlComment = true
      current.push(line)
      continue
    }

    if (HEADING_RE.test(line)) {
      flush()
      blocks.push(line)
      continue
    }

    if (THEMATIC_BREAK_RE.test(line) && current.length === 0) {
      blocks.push(line)
      continue
    }

    if (trimmed.startsWith('<')) {
      updateHtmlStack(line, htmlStack)
      if (htmlStack.length > 0 && current.length > 0) {
        flush()
      }
      current.push(line)
      continue
    }

    current.push(line)
  }

  flush()
  return blocks
}
