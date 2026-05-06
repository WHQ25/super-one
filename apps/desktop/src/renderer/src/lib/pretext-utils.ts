import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext'

export const MONO_FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
const MONO_FONT = `11px ${MONO_FONT_FAMILY}`

let cachedMonoCharWidth: number | null = null

export function getMonoFont(): string {
  return MONO_FONT
}

export function getMonoCharWidth(): number {
  if (cachedMonoCharWidth !== null) return cachedMonoCharWidth
  const prepared = prepareWithSegments('0', MONO_FONT)
  let w = 6.6
  walkLineRanges(prepared, 99999, (line) => { w = line.width })
  cachedMonoCharWidth = w
  return w
}

export function measureMaxLineWidth(text: string, font: string): number {
  if (!text) return 0
  const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' })
  let maxW = 0
  walkLineRanges(prepared, 99999, (line) => { if (line.width > maxW) maxW = line.width })
  return maxW
}

export function getComputedFont(el: HTMLElement): string {
  const s = window.getComputedStyle(el)
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
}
