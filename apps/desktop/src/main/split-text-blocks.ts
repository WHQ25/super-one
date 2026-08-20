import {
  INSIGHT_HEADER_LINE,
  INSIGHT_BLOCK_PREFIX,
  stripBlockPrefix,
  findInsightBodyEnd,
} from '@superone/shared/insight-markers'

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
  let openInsight: { title: string; body: string[] } | null = null

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

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
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

    const insightMatch = line.match(INSIGHT_HEADER_LINE)
    if (insightMatch) {
      if (inTable) flushTable()
      const rawLeading = insightMatch[1]
      const prefix = INSIGHT_BLOCK_PREFIX.test(rawLeading) ? rawLeading : ''
      const leading = prefix ? '' : rawLeading.trimEnd()
      if (leading) current.push(leading)
      flushCurrent()
      const title = insightMatch[2].trim()
      const body = lines.slice(li + 1).map((l) => stripBlockPrefix(l, prefix))
      const found = findInsightBodyEnd(body, !streaming)
      if (found.kind === 'none') {
        // Still open at the end of the text: hold it back while streaming so the
        // footer can still arrive, and close it at EOF once the turn is final.
        openInsight = { title, body }
        li = lines.length
        break
      }
      const content = found.kind === 'footer' && found.inlineContent !== null
        ? [...body.slice(0, found.end), found.inlineContent]
        : body.slice(0, found.end)
      segments.push({ type: 'insight', text: '', title, content: content.join('\n') })
      li = li + found.next
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
    if (openInsight) {
      if (inTable) flushTable()
      flushCurrent()
      const remainder = `\`★ ${openInsight.title} ${'─'.repeat(37)}\`\n${openInsight.body.join('\n')}`
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

  if (openInsight) {
    if (inTable) flushTable()
    flushCurrent()
    segments.push({ type: 'insight', text: '', title: openInsight.title, content: openInsight.body.join('\n') })
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
