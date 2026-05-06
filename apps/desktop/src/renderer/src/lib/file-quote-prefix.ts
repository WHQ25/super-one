export function compressLineRanges(lines: number[]): string {
  const sorted = Array.from(new Set(lines.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const ranges: string[] = []
  let start = sorted[0]
  let prev = start
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) {
      prev = n
      continue
    }
    ranges.push(start === prev ? `L${start}` : `L${start}-L${prev}`)
    start = n
    prev = n
  }
  ranges.push(start === prev ? `L${start}` : `L${start}-L${prev}`)
  return ranges.join(',')
}

export function expandLineRanges(rangeText: string): number[] {
  const lines: number[] = []
  for (const part of rangeText.split(',')) {
    const m = part.trim().match(/^L(\d+)(?:-L(\d+))?$/)
    if (!m) continue
    const start = Number.parseInt(m[1], 10)
    const end = m[2] ? Number.parseInt(m[2], 10) : start
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
    for (let n = start; n <= end; n++) lines.push(n)
  }
  return lines
}

export type LineKind = 'unchanged' | 'added' | 'removed'

export interface ParsedFilePrefix {
  prefix: string
  filePath: string
  rangeText: string
  body: string
  selStartCol: number | null
  selEndCol: number | null
  isDiff: boolean
}

export interface DiffBodyLine {
  kind: LineKind
  text: string
}

const PREFIX_PATTERN = /^(.+):(L\d+(?:-L\d+)?(?:,L\d+(?:-L\d+)?)*)(?::C(\d+)-C(\d+))?(:D)?$/

export function parseFilePrefix(text: string): ParsedFilePrefix | null {
  const newlineIdx = text.indexOf('\n')
  if (newlineIdx < 0) return null
  const firstLine = text.slice(0, newlineIdx)
  const body = text.slice(newlineIdx + 1)
  const match = firstLine.match(PREFIX_PATTERN)
  if (!match) return null
  const selStartCol = match[3] ? Number.parseInt(match[3], 10) : null
  const selEndCol = match[4] ? Number.parseInt(match[4], 10) : null
  return {
    prefix: firstLine,
    filePath: match[1],
    rangeText: match[2],
    body,
    selStartCol: Number.isFinite(selStartCol as number) ? selStartCol : null,
    selEndCol: Number.isFinite(selEndCol as number) ? selEndCol : null,
    isDiff: !!match[5],
  }
}

export function formatFilePrefix(
  filePath: string,
  rangeText: string,
  selStartCol?: number,
  selEndCol?: number,
  isDiff?: boolean,
): string {
  const colSuffix = selStartCol != null && selEndCol != null ? `:C${selStartCol}-C${selEndCol}` : ''
  const diffSuffix = isDiff ? ':D' : ''
  return `${filePath}:${rangeText}${colSuffix}${diffSuffix}`
}

export function lineKindToMarker(kind: LineKind): string {
  if (kind === 'added') return '+'
  if (kind === 'removed') return '-'
  return ' '
}

export function markerToLineKind(marker: string): LineKind {
  if (marker === '+') return 'added'
  if (marker === '-') return 'removed'
  return 'unchanged'
}

export function parseDiffBody(body: string): DiffBodyLine[] {
  return body.split('\n').map((raw) => {
    const marker = raw.charAt(0)
    return { kind: markerToLineKind(marker), text: raw.slice(1) }
  })
}
