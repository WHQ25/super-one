export type EditorTool =
  | 'select'
  | 'pen'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'marker'
  | 'mosaic'

export const EDITOR_TOOL_SHORTCUTS: Record<EditorTool, string> = {
  select: 'V',
  pen: 'P',
  rect: 'R',
  ellipse: 'O',
  line: 'L',
  arrow: 'A',
  text: 'T',
  marker: 'M',
  mosaic: 'B',
}

export const EDITOR_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ffffff', // White
  '#18181b', // Black
] as const

export const EDITOR_STROKE_WIDTHS = [2, 4, 8, 14] as const

export interface Point {
  x: number
  y: number
}

export interface BoxRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PenAnnotation {
  id: string
  kind: 'pen'
  color: string
  strokeWidth: number
  points: Point[]
}

export interface BoxShapeAnnotation {
  id: string
  kind: 'rect' | 'ellipse'
  color: string
  strokeWidth: number
  x: number
  y: number
  width: number
  height: number
}

export interface LineShapeAnnotation {
  id: string
  kind: 'line' | 'arrow'
  color: string
  strokeWidth: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface TextAnnotation {
  id: string
  kind: 'text'
  color: string
  strokeWidth: number
  text: string
  x: number
  y: number
  fontSize: number
}

export interface MarkerAnnotation {
  id: string
  kind: 'marker'
  color: string
  strokeWidth: number
  number: number
  x: number
  y: number
  radius: number
}

export interface MosaicAnnotation {
  id: string
  kind: 'mosaic'
  x: number
  y: number
  width: number
  height: number
  ocrKey?: string
}

export type ImageAnnotation =
  | PenAnnotation
  | BoxShapeAnnotation
  | LineShapeAnnotation
  | TextAnnotation
  | MarkerAnnotation
  | MosaicAnnotation

export interface OcrTextRegion {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export type BoxResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type LineResizeHandle = 'start' | 'end'
export type TextResizeHandle = 'scale'
export type ResizeHandle = BoxResizeHandle | LineResizeHandle | TextResizeHandle

export interface HandlePosition {
  handle: ResizeHandle
  x: number
  y: number
}

export interface EditorHistoryState {
  past: ImageAnnotation[][]
  present: ImageAnnotation[]
  future: ImageAnnotation[][]
}

export function createHistoryState(initial: ImageAnnotation[] = []): EditorHistoryState {
  return {
    past: [],
    present: initial,
    future: [],
  }
}

export function pushHistory(state: EditorHistoryState, next: ImageAnnotation[]): EditorHistoryState {
  if (next === state.present) return state
  return {
    past: [...state.past, state.present],
    present: next,
    future: [],
  }
}

export function undoHistory(state: EditorHistoryState): EditorHistoryState {
  if (state.past.length === 0) return state
  const previous = state.past[state.past.length - 1]!
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  }
}

export function redoHistory(state: EditorHistoryState): EditorHistoryState {
  if (state.future.length === 0) return state
  const [next, ...rest] = state.future
  return {
    past: [...state.past, state.present],
    present: next!,
    future: rest,
  }
}

export function clearHistory(state: EditorHistoryState): EditorHistoryState {
  if (state.present.length === 0) return state
  return pushHistory(state, [])
}

/** Scale factor relative to a ~1100px reference long-side so strokes and markers scale naturally with resolution. */
export function scaleForImage(imageWidth: number, imageHeight: number): number {
  const ref = Math.max(Math.max(1, imageWidth), Math.max(1, imageHeight))
  return Math.max(0.4, ref / 1100)
}

export function defaultMarkerRadius(strokeWidth: number, imageScale: number): number {
  return Math.round((13 + strokeWidth * 1.4) * imageScale * 10) / 10
}

export function defaultTextFontSize(strokeWidth: number, imageScale: number): number {
  return Math.round((16 + strokeWidth * 2.5) * imageScale * 10) / 10
}

export function estimateTextLineUnits(line: string): number {
  let units = 0
  for (const ch of line) {
    units += ch.charCodeAt(0) > 255 ? 1 : 0.6
  }
  return Math.max(1, units)
}

export function getTextBox(annotation: TextAnnotation): BoxRect {
  const lines = (annotation.text || ' ').split('\n')
  const lineHeight = annotation.fontSize * 1.28
  let maxUnits = 1
  for (const line of lines) {
    const u = estimateTextLineUnits(line)
    if (u > maxUnits) maxUnits = u
  }
  const width = Math.max(annotation.fontSize * 0.8, maxUnits * annotation.fontSize)
  const height = Math.max(annotation.fontSize, lines.length * lineHeight)
  return {
    x: annotation.x,
    y: annotation.y,
    width,
    height,
  }
}

export function nextMarkerNumber(annotations: readonly ImageAnnotation[]): number {
  let max = 0
  for (const ann of annotations) {
    if (ann.kind === 'marker' && ann.number > max) {
      max = ann.number
    }
  }
  return max + 1
}

export function normalizeBox(x1: number, y1: number, x2: number, y2: number): BoxRect {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  return {
    x,
    y,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

export function getAnnotationHandles(annotation: ImageAnnotation): HandlePosition[] {
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
    case 'mosaic': {
      const { x, y, width, height } = annotation
      const cx = x + width / 2
      const cy = y + height / 2
      const r = x + width
      const b = y + height
      return [
        { handle: 'nw', x, y },
        { handle: 'n', x: cx, y },
        { handle: 'ne', x: r, y },
        { handle: 'e', x: r, y: cy },
        { handle: 'se', x: r, y: b },
        { handle: 's', x: cx, y: b },
        { handle: 'sw', x, y: b },
        { handle: 'w', x, y: cy },
      ]
    }
    case 'line':
    case 'arrow':
      return [
        { handle: 'start', x: annotation.x1, y: annotation.y1 },
        { handle: 'end', x: annotation.x2, y: annotation.y2 },
      ]
    case 'text': {
      const box = getTextBox(annotation)
      return [
        { handle: 'scale', x: box.x + box.width, y: box.y + box.height },
      ]
    }
    case 'marker':
    case 'pen':
      return []
  }
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return distanceBetween(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function hitTestHandle(
  annotation: ImageAnnotation,
  point: Point,
  tolerance: number,
): ResizeHandle | null {
  const handles = getAnnotationHandles(annotation)
  for (const h of handles) {
    if (distanceBetween(point, h) <= tolerance) {
      return h.handle
    }
  }
  return null
}

export function hitTestAnnotation(
  annotation: ImageAnnotation,
  point: Point,
  tolerance: number,
): boolean {
  switch (annotation.kind) {
    case 'rect':
    case 'mosaic': {
      const { x, y, width, height } = annotation
      return (
        point.x >= x - tolerance &&
        point.x <= x + width + tolerance &&
        point.y >= y - tolerance &&
        point.y <= y + height + tolerance
      )
    }
    case 'text': {
      const box = getTextBox(annotation)
      return (
        point.x >= box.x - tolerance &&
        point.x <= box.x + box.width + tolerance &&
        point.y >= box.y - tolerance &&
        point.y <= box.y + box.height + tolerance
      )
    }
    case 'ellipse': {
      const rx = Math.max(1, annotation.width / 2) + tolerance
      const ry = Math.max(1, annotation.height / 2) + tolerance
      const cx = annotation.x + annotation.width / 2
      const cy = annotation.y + annotation.height / 2
      const nx = (point.x - cx) / rx
      const ny = (point.y - cy) / ry
      return nx * nx + ny * ny <= 1
    }
    case 'line':
    case 'arrow': {
      const strokeTol = Math.max(tolerance, annotation.strokeWidth / 2 + tolerance * 0.75)
      return (
        distanceToSegment(
          point,
          { x: annotation.x1, y: annotation.y1 },
          { x: annotation.x2, y: annotation.y2 },
        ) <= strokeTol
      )
    }
    case 'marker': {
      return distanceBetween(point, { x: annotation.x, y: annotation.y }) <= annotation.radius + tolerance
    }
    case 'pen': {
      const pts = annotation.points
      if (pts.length === 0) return false
      const strokeTol = Math.max(tolerance, annotation.strokeWidth / 2 + tolerance * 0.5)
      if (pts.length === 1) return distanceBetween(point, pts[0]!) <= strokeTol
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(point, pts[i - 1]!, pts[i]!) <= strokeTol) return true
      }
      return false
    }
  }
}

export function findTopmostAnnotationAt(
  annotations: readonly ImageAnnotation[],
  point: Point,
  tolerance: number,
): ImageAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i]!
    if (hitTestAnnotation(ann, point, tolerance)) {
      return ann
    }
  }
  return null
}

export function moveAnnotation(annotation: ImageAnnotation, dx: number, dy: number): ImageAnnotation {
  if (dx === 0 && dy === 0) return annotation
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
    case 'mosaic':
    case 'text':
      return {
        ...annotation,
        x: annotation.x + dx,
        y: annotation.y + dy,
      }
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        x1: annotation.x1 + dx,
        y1: annotation.y1 + dy,
        x2: annotation.x2 + dx,
        y2: annotation.y2 + dy,
      }
    case 'marker':
      return {
        ...annotation,
        x: annotation.x + dx,
        y: annotation.y + dy,
      }
    case 'pen':
      return {
        ...annotation,
        points: annotation.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
      }
  }
}

export function resizeAnnotation(
  annotation: ImageAnnotation,
  handle: ResizeHandle,
  point: Point,
  minSize = 6,
): ImageAnnotation {
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
    case 'mosaic': {
      let left = annotation.x
      let top = annotation.y
      let right = annotation.x + annotation.width
      let bottom = annotation.y + annotation.height

      if (handle === 'nw' || handle === 'w' || handle === 'sw') left = point.x
      if (handle === 'ne' || handle === 'e' || handle === 'se') right = point.x
      if (handle === 'nw' || handle === 'n' || handle === 'ne') top = point.y
      if (handle === 'sw' || handle === 's' || handle === 'se') bottom = point.y

      const box = normalizeBox(left, top, right, bottom)
      return {
        ...annotation,
        x: box.x,
        y: box.y,
        width: Math.max(minSize, box.width),
        height: Math.max(minSize, box.height),
      }
    }
    case 'line':
    case 'arrow': {
      if (handle === 'start') {
        return { ...annotation, x1: point.x, y1: point.y }
      }
      if (handle === 'end') {
        return { ...annotation, x2: point.x, y2: point.y }
      }
      return annotation
    }
    case 'text': {
      if (handle === 'scale') {
        const box = getTextBox(annotation)
        const baseDiag = Math.max(10, Math.hypot(box.width, box.height))
        const nextDiag = Math.max(10, Math.hypot(Math.max(8, point.x - annotation.x), Math.max(8, point.y - annotation.y)))
        const ratio = nextDiag / baseDiag
        const nextFontSize = Math.max(10, Math.min(240, Math.round(annotation.fontSize * ratio * 10) / 10))
        return { ...annotation, fontSize: nextFontSize }
      }
      return annotation
    }
    case 'marker':
    case 'pen':
      return annotation
  }
}

export function updateAnnotationStyle(
  annotation: ImageAnnotation,
  patch: { color?: string; strokeWidth?: number; imageScale?: number },
): ImageAnnotation {
  if (annotation.kind === 'mosaic') return annotation
  if (annotation.kind === 'marker') {
    const nextStroke = patch.strokeWidth ?? annotation.strokeWidth
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      strokeWidth: nextStroke,
      radius: patch.strokeWidth !== undefined && patch.imageScale !== undefined
        ? defaultMarkerRadius(nextStroke, patch.imageScale)
        : annotation.radius,
    }
  }
  if (annotation.kind === 'text') {
    const nextStroke = patch.strokeWidth ?? annotation.strokeWidth
    return {
      ...annotation,
      color: patch.color ?? annotation.color,
      strokeWidth: nextStroke,
      fontSize: patch.strokeWidth !== undefined && patch.imageScale !== undefined
        ? defaultTextFontSize(nextStroke, patch.imageScale)
        : annotation.fontSize,
    }
  }
  return {
    ...annotation,
    color: patch.color ?? annotation.color,
    strokeWidth: patch.strokeWidth ?? annotation.strokeWidth,
  }
}

export function ocrRegionKey(region: OcrTextRegion): string {
  return `${Math.round(region.x)}:${Math.round(region.y)}:${Math.round(region.width)}:${Math.round(region.height)}`
}

export function expandOcrBox(region: OcrTextRegion, imageWidth: number, imageHeight: number, pad = 4): BoxRect {
  const x = Math.max(0, Math.floor(region.x - pad))
  const y = Math.max(0, Math.floor(region.y - pad))
  const right = Math.min(imageWidth, Math.ceil(region.x + region.width + pad))
  const bottom = Math.min(imageHeight, Math.ceil(region.y + region.height + pad))
  return {
    x,
    y,
    width: Math.max(4, right - x),
    height: Math.max(4, bottom - y),
  }
}

export function isOcrRegionRedacted(annotations: readonly ImageAnnotation[], region: OcrTextRegion): boolean {
  const key = ocrRegionKey(region)
  const cx = region.x + region.width / 2
  const cy = region.y + region.height / 2
  return annotations.some((ann) => {
    if (ann.kind !== 'mosaic') return false
    if (ann.ocrKey && ann.ocrKey === key) return true
    return cx >= ann.x && cx <= ann.x + ann.width && cy >= ann.y && cy <= ann.y + ann.height
  })
}

export function hitTestOcrRegion(regions: readonly OcrTextRegion[], point: Point, pad = 4): OcrTextRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!
    if (
      point.x >= r.x - pad &&
      point.x <= r.x + r.width + pad &&
      point.y >= r.y - pad &&
      point.y <= r.y + r.height + pad
    ) {
      return r
    }
  }
  return null
}

export function toggleOcrRegionMosaic(
  annotations: readonly ImageAnnotation[],
  region: OcrTextRegion,
  imageWidth: number,
  imageHeight: number,
  createId: () => string,
): ImageAnnotation[] {
  const key = ocrRegionKey(region)
  const existingIdx = annotations.findIndex((ann) => ann.kind === 'mosaic' && ann.ocrKey === key)
  if (existingIdx >= 0) {
    return annotations.filter((_, idx) => idx !== existingIdx)
  }
  const box = expandOcrBox(region, imageWidth, imageHeight)
  const mosaic: MosaicAnnotation = {
    id: createId(),
    kind: 'mosaic',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    ocrKey: key,
  }
  return [...annotations, mosaic]
}

export function redactAllOcrRegions(
  annotations: readonly ImageAnnotation[],
  regions: readonly OcrTextRegion[],
  imageWidth: number,
  imageHeight: number,
  createId: () => string,
): ImageAnnotation[] {
  let next = [...annotations]
  for (const region of regions) {
    if (!isOcrRegionRedacted(next, region)) {
      const box = expandOcrBox(region, imageWidth, imageHeight)
      next.push({
        id: createId(),
        kind: 'mosaic',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        ocrKey: ocrRegionKey(region),
      })
    }
  }
  return next
}
