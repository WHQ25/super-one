const INSIGHT_HEADER_RE = /^(.*?)(?:#{1,6}\s+)?`?★\s+(.+?)\s+─{3,}`?\s*$/m
const INSIGHT_FOOTER_RE = /^`?─{3,}`?\s*$/
const INSIGHT_INLINE_FOOTER_RE = /^(?!`?─)(.+?\S)\s+`?─{3,}`?\s*$/
const INSIGHT_BLOCK_PREFIX = /^[>\s]+$/

function stripBlockPrefix(line: string, prefix: string): string {
  if (!prefix) return line
  if (line.startsWith(prefix)) return line.slice(prefix.length)
  if (prefix.includes('>')) {
    const m = line.match(/^\s*>\s?/)
    if (m) return line.slice(m[0].length)
  }
  return line
}

export interface TextSegment { type: 'text' | 'insight'; text: string; title?: string; content?: string }
export interface SplitResult { segments: TextSegment[]; remainder: string }

export function splitTextIntoBlocks(text: string, streaming = false): SplitResult {
  if (!text.trim()) return { segments: [], remainder: '' }
  const lines = text.split('\n')
  const segments: TextSegment[] = []
  let current: string[] = []
  let inCodeFence = false
  let fenceTicks = ''
  let codeLines: string[] = []
  let codeLang = ''
  let inTable = false
  let tableLines: string[] = []
  let insightTitle: string | null = null
  let insightLines: string[] = []
  let insightPrefix = ''

  function flushCurrent() {
    const t = current.join('\n').trim()
    if (t) segments.push({ type: 'text', text: t })
    current = []
  }

  function flushTable() {
    if (tableLines.length > 0) {
      segments.push({ type: 'text', text: tableLines.join('\n') })
      tableLines = []
    }
    inTable = false
  }

  for (const line of lines) {
    if (insightTitle !== null) {
      const stripped = stripBlockPrefix(line, insightPrefix)
      if (INSIGHT_FOOTER_RE.test(stripped)) {
        segments.push({ type: 'insight', text: '', title: insightTitle, content: insightLines.join('\n') })
        insightTitle = null
        insightLines = []
        insightPrefix = ''
      } else {
        const inlineMatch = stripped.match(INSIGHT_INLINE_FOOTER_RE)
        if (inlineMatch) {
          insightLines.push(inlineMatch[1])
          segments.push({ type: 'insight', text: '', title: insightTitle, content: insightLines.join('\n') })
          insightTitle = null
          insightLines = []
          insightPrefix = ''
        } else {
          insightLines.push(stripped)
        }
      }
      continue
    }

    if (inCodeFence) {
      if (line.trimEnd() === fenceTicks) {
        segments.push({ type: 'text', text: `${fenceTicks}${codeLang}\n${codeLines.join('\n')}\n${fenceTicks}` })
        inCodeFence = false
        fenceTicks = ''
        codeLines = []
        codeLang = ''
      } else {
        codeLines.push(line)
      }
      continue
    }

    const fenceMatch = line.match(/^(`{3,})(\w*)/)
    if (fenceMatch) {
      if (inTable) flushTable()
      flushCurrent()
      inCodeFence = true
      fenceTicks = fenceMatch[1]
      codeLang = fenceMatch[2] || ''
      codeLines = []
      continue
    }

    const insightMatch = line.match(INSIGHT_HEADER_RE)
    if (insightMatch) {
      if (inTable) flushTable()
      const rawLeading = insightMatch[1]
      insightPrefix = INSIGHT_BLOCK_PREFIX.test(rawLeading) ? rawLeading : ''
      const leading = insightPrefix ? '' : rawLeading.trimEnd()
      if (leading) current.push(leading)
      flushCurrent()
      insightTitle = insightMatch[2].trim()
      insightLines = []
      continue
    }

    if (line.startsWith('|') && (inTable || line.includes('|', 1))) {
      if (!inTable) {
        flushCurrent()
        inTable = true
      }
      tableLines.push(line)
      continue
    }

    if (inTable && line.trimEnd().endsWith('|') && line.includes('|')) {
      tableLines[tableLines.length - 1] += line
      continue
    }

    if (inTable) flushTable()
    current.push(line)
  }

  if (streaming) {
    if (insightTitle !== null) {
      if (inTable) flushTable()
      flushCurrent()
      const remainder = `\`★ ${insightTitle} ${'─'.repeat(37)}\`\n${insightLines.join('\n')}`
      return { segments, remainder }
    }
    if (inCodeFence) {
      if (inTable) flushTable()
      flushCurrent()
      const remainder = `${fenceTicks}${codeLang}\n${codeLines.join('\n')}`
      return { segments, remainder }
    }
    if (inTable) {
      flushCurrent()
      const remainder = tableLines.join('\n')
      return { segments, remainder }
    }
    const tail = current.join('\n')
    const breakIdx = tail.lastIndexOf('\n\n')
    if (breakIdx >= 0) {
      const before = tail.slice(0, breakIdx).trim()
      if (before) segments.push({ type: 'text', text: before })
      const remainder = tail.slice(breakIdx + 2)
      return { segments, remainder }
    }
    return { segments, remainder: tail }
  }

  if (insightTitle !== null) {
    if (inTable) flushTable()
    flushCurrent()
    segments.push({ type: 'insight', text: '', title: insightTitle, content: insightLines.join('\n') })
    return { segments, remainder: '' }
  }
  if (inCodeFence) {
    current.push(`${fenceTicks}${codeLang}`)
    current.push(...codeLines)
  }
  if (inTable) flushTable()
  flushCurrent()
  return { segments, remainder: '' }
}
