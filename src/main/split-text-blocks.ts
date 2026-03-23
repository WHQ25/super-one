const INSIGHT_HEADER_RE = /^`★\s+(.+?)\s+─{3,}`$/m
const INSIGHT_FOOTER_RE = /^`─{3,}`$/

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
      if (INSIGHT_FOOTER_RE.test(line)) {
        segments.push({ type: 'insight', text: '', title: insightTitle, content: insightLines.join('\n') })
        insightTitle = null
        insightLines = []
      } else {
        insightLines.push(line)
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
      flushCurrent()
      insightTitle = insightMatch[1].trim()
      insightLines = []
      continue
    }

    if (line.startsWith('|') && line.includes('|', 1)) {
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
    if (inTable) flushTable()
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
    current.push(`\`★ ${insightTitle} ${'─'.repeat(37)}\``)
    current.push(...insightLines)
  }
  if (inCodeFence) {
    current.push(`${fenceTicks}${codeLang}`)
    current.push(...codeLines)
  }
  if (inTable) flushTable()
  flushCurrent()
  return { segments, remainder: '' }
}
