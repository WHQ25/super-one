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
  ellipse: 'E',
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
  /** Clockwise radians around the box center. Canvas y grows downward. */
  rotation?: number
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
  /** Wrap width in image pixels. Omit to shrink-wrap each line. */
  width?: number
  /** Frame height in image pixels. Omit to hug the laid-out lines. */
  height?: number
  /** Clockwise radians around the text box center. Canvas y grows downward. */
  rotation?: number
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
export type RotateHandle = 'rotate'
export type ResizeHandle = BoxResizeHandle | LineResizeHandle | RotateHandle

export const TEXT_LINE_HEIGHT = 1.28
export const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'

/** Screen pixels from the top edge to the rotation handle center. Scaled by uiScale into image pixels. */
export const ROTATE_HANDLE_GAP = 12

export function textFont(fontSize: number): string {
  return `600 ${Math.round(fontSize * 10) / 10}px ${TEXT_FONT_FAMILY}`
}

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
  return Math.max(1, rawTextLineUnits(line))
}

function rawTextLineUnits(line: string): number {
  let units = 0
  for (const ch of line) {
    units += ch.charCodeAt(0) > 255 ? 1 : 0.6
  }
  return units
}

function wrapTextLine(line: string, maxWidth: number, fontSize: number): string[] {
  if (!line) return ['']
  const maxUnits = maxWidth / Math.max(1, fontSize)
  const out: string[] = []
  let current = ''
  let units = 0
  for (const ch of line) {
    const u = ch.charCodeAt(0) > 255 ? 1 : 0.6
    if (current && units + u > maxUnits + 1e-6) {
      out.push(current)
      current = ch
      units = u
    } else {
      current += ch
      units += u
    }
  }
  out.push(current)
  return out
}

export interface TextLayout {
  width: number
  height: number
  fontSize: number
  lineHeight: number
  lines: string[]
}

/** Shared by the canvas, the hit target, and the editing field. */
export function layoutText(annotation: Pick<TextAnnotation, 'text' | 'fontSize' | 'width'>): TextLayout {
  const fontSize = Math.max(10, annotation.fontSize)
  const lineHeight = fontSize * TEXT_LINE_HEIGHT
  const source = annotation.text ?? ''
  const paragraphs = source.split('\n')
  const lines: string[] = []
  const wrapWidth = annotation.width
  for (const paragraph of paragraphs) {
    if (wrapWidth && wrapWidth > 0) {
      lines.push(...wrapTextLine(paragraph, wrapWidth, fontSize))
    } else {
      lines.push(paragraph)
    }
  }
  if (lines.length === 0) lines.push('')
  let maxUnits = 0
  for (const line of lines) {
    maxUnits = Math.max(maxUnits, rawTextLineUnits(line))
  }
  const contentWidth = Math.max(fontSize * 0.8, Math.max(1, maxUnits) * fontSize)
  const width = wrapWidth && wrapWidth > 0 ? Math.max(fontSize * 0.8, wrapWidth) : contentWidth
  const height = Math.max(lineHeight, lines.length * lineHeight)
  return { width, height, fontSize, lineHeight, lines }
}

export function getTextBox(annotation: TextAnnotation): BoxRect {
  const layout = layoutText(annotation)
  return {
    x: annotation.x,
    y: annotation.y,
    width: layout.width,
    height: Math.max(layout.height, annotation.height ?? 0),
  }
}

export function annotationRotation(annotation: ImageAnnotation): number {
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse' || annotation.kind === 'text') {
    return annotation.rotation ?? 0
  }
  return 0
}

export function rotatePoint(point: Point, center: Point, angle: number): Point {
  if (!angle) return point
  const dx = point.x - center.x
  const dy = point.y - center.y
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dy * cos + dx * sin,
  }
}

export function unrotatePoint(point: Point, center: Point, angle: number): Point {
  return rotatePoint(point, center, -angle)
}

function boxCenter(box: BoxRect): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function annotationFrame(annotation: ImageAnnotation): (BoxRect & { rotation: number }) | null {
  if (annotation.kind === 'rect' || annotation.kind === 'ellipse' || annotation.kind === 'mosaic') {
    return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height, rotation: annotationRotation(annotation) }
  }
  if (annotation.kind === 'text') {
    const box = getTextBox(annotation)
    return { ...box, rotation: annotation.rotation ?? 0 }
  }
  return null
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

function handlesForFrame(frame: BoxRect & { rotation: number }, uiScale: number, withRotate: boolean): HandlePosition[] {
  const center = boxCenter(frame)
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  const corners: Array<[ResizeHandle, number, number]> = [
    ['nw', frame.x, frame.y],
    ['ne', right, frame.y],
    ['se', right, bottom],
    ['sw', frame.x, bottom],
  ]
  const handles: HandlePosition[] = corners.map(([handle, x, y]) => ({
    handle,
    ...rotatePoint({ x, y }, center, frame.rotation),
  }))
  if (withRotate) {
    handles.push({
      handle: 'rotate',
      ...rotatePoint(
        { x: frame.x + frame.width / 2, y: frame.y - ROTATE_HANDLE_GAP * uiScale },
        center,
        frame.rotation,
      ),
    })
  }
  return handles
}

export function getAnnotationHandles(annotation: ImageAnnotation, uiScale = 1): HandlePosition[] {
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
    case 'text': {
      const frame = annotationFrame(annotation)
      return frame ? handlesForFrame(frame, uiScale, true) : []
    }
    case 'mosaic': {
      const frame = annotationFrame(annotation)
      return frame ? handlesForFrame(frame, uiScale, false) : []
    }
    case 'line':
    case 'arrow':
      return [
        { handle: 'start', x: annotation.x1, y: annotation.y1 },
        { handle: 'end', x: annotation.x2, y: annotation.y2 },
      ]
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

function hitTestFrameEdge(
  frame: BoxRect & { rotation: number },
  point: Point,
  tolerance: number,
  uiScale: number,
): BoxResizeHandle | null {
  const center = boxCenter(frame)
  const local = unrotatePoint(point, center, frame.rotation)
  const left = frame.x
  const right = frame.x + frame.width
  const top = frame.y
  const bottom = frame.y + frame.height
  // A thin band. Short text boxes keep the middle free for moving.
  const outside = Math.min(tolerance, 4.5 * uiScale)
  const insideX = Math.min(outside, frame.width * 0.18)
  const insideY = Math.min(outside, frame.height * 0.18)
  if (
    local.x < left - outside ||
    local.x > right + outside ||
    local.y < top - outside ||
    local.y > bottom + outside
  ) {
    return null
  }
  const edges: Array<[BoxResizeHandle, number, number, boolean]> = [
    ['n', Math.abs(local.y - top), local.y < top ? outside : insideY, local.x >= left && local.x <= right],
    ['s', Math.abs(local.y - bottom), local.y > bottom ? outside : insideY, local.x >= left && local.x <= right],
    ['w', Math.abs(local.x - left), local.x < left ? outside : insideX, local.y >= top && local.y <= bottom],
    ['e', Math.abs(local.x - right), local.x > right ? outside : insideX, local.y >= top && local.y <= bottom],
  ]
  let best: BoxResizeHandle | null = null
  let bestDist = Infinity
  for (const [handle, dist, limit, insideSpan] of edges) {
    if (!insideSpan || dist > limit || dist >= bestDist) continue
    best = handle
    bestDist = dist
  }
  return best
}

export function hitTestHandle(
  annotation: ImageAnnotation,
  point: Point,
  tolerance: number,
  uiScale = 1,
): ResizeHandle | null {
  let best: ResizeHandle | null = null
  let bestDist = Infinity
  for (const handle of getAnnotationHandles(annotation, uiScale)) {
    const dist = distanceBetween(point, handle)
    // The knob sits just above the top edge, so its grab radius stays inside that gap.
    const limit = handle.handle === 'rotate' ? Math.min(tolerance, 8 * uiScale) : tolerance
    if (dist <= limit && dist < bestDist) {
      best = handle.handle
      bestDist = dist
    }
  }
  if (best) return best
  const frame = annotationFrame(annotation)
  if (!frame) return null
  return hitTestFrameEdge(frame, point, tolerance, uiScale)
}

function hitTestFrame(frame: BoxRect & { rotation: number }, point: Point, tolerance: number, elliptical: boolean): boolean {
  const center = boxCenter(frame)
  const local = unrotatePoint(point, center, frame.rotation)
  if (elliptical) {
    const rx = Math.max(1, frame.width / 2) + tolerance
    const ry = Math.max(1, frame.height / 2) + tolerance
    const nx = (local.x - center.x) / rx
    const ny = (local.y - center.y) / ry
    return nx * nx + ny * ny <= 1
  }
  return (
    local.x >= frame.x - tolerance &&
    local.x <= frame.x + frame.width + tolerance &&
    local.y >= frame.y - tolerance &&
    local.y <= frame.y + frame.height + tolerance
  )
}

export function hitTestAnnotation(
  annotation: ImageAnnotation,
  point: Point,
  tolerance: number,
): boolean {
  switch (annotation.kind) {
    case 'rect':
    case 'mosaic':
    case 'text': {
      const frame = annotationFrame(annotation)
      return frame ? hitTestFrame(frame, point, tolerance, false) : false
    }
    case 'ellipse': {
      const frame = annotationFrame(annotation)
      return frame ? hitTestFrame(frame, point, tolerance, true) : false
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

function isBoxHandle(handle: ResizeHandle): handle is BoxResizeHandle {
  return (
    handle === 'nw' ||
    handle === 'n' ||
    handle === 'ne' ||
    handle === 'e' ||
    handle === 'se' ||
    handle === 's' ||
    handle === 'sw' ||
    handle === 'w'
  )
}

/** Resize a box in its local space and keep the opposite edge fixed in world space. */
export function resizeRotatedBox(
  box: BoxRect & { rotation?: number },
  handle: BoxResizeHandle,
  point: Point,
  minWidth: number,
  minHeight: number,
): BoxRect {
  const rotation = box.rotation ?? 0
  const center = boxCenter(box)
  const local = unrotatePoint(point, center, rotation)
  const lx = local.x - center.x
  const ly = local.y - center.y
  let left = -box.width / 2
  let right = box.width / 2
  let top = -box.height / 2
  let bottom = box.height / 2
  const dragW = handle === 'nw' || handle === 'w' || handle === 'sw'
  const dragE = handle === 'ne' || handle === 'e' || handle === 'se'
  const dragN = handle === 'nw' || handle === 'n' || handle === 'ne'
  const dragS = handle === 'sw' || handle === 's' || handle === 'se'
  if (dragW) left = Math.min(lx, right - minWidth)
  if (dragE) right = Math.max(lx, left + minWidth)
  if (dragN) top = Math.min(ly, bottom - minHeight)
  if (dragS) bottom = Math.max(ly, top + minHeight)
  const width = right - left
  const height = bottom - top
  const offsetX = (left + right) / 2
  const offsetY = (top + bottom) / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const nextCenterX = center.x + offsetX * cos - offsetY * sin
  const nextCenterY = center.y + offsetX * sin + offsetY * cos
  return {
    x: nextCenterX - width / 2,
    y: nextCenterY - height / 2,
    width,
    height,
  }
}

function boxKeepingTop(box: BoxRect, rotation: number, nextHeight: number): BoxRect {
  const center = boxCenter(box)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const topLocalY = -box.height / 2
  const topX = center.x - topLocalY * sin
  const topY = center.y + topLocalY * cos
  const half = nextHeight / 2
  const nextCenterX = topX - half * sin
  const nextCenterY = topY + half * cos
  return {
    x: nextCenterX - box.width / 2,
    y: nextCenterY - nextHeight / 2,
    width: box.width,
    height: nextHeight,
  }
}

const TEXT_CORNERS: Record<'nw' | 'ne' | 'se' | 'sw', 'nw' | 'ne' | 'se' | 'sw'> = {
  nw: 'se',
  ne: 'sw',
  se: 'nw',
  sw: 'ne',
}

function scaleTextFromCorner(annotation: TextAnnotation, handle: 'nw' | 'ne' | 'se' | 'sw', point: Point): TextAnnotation {
  const box = getTextBox(annotation)
  const rotation = annotation.rotation ?? 0
  const center = boxCenter(box)
  const halfW = box.width / 2
  const halfH = box.height / 2
  const locals = {
    nw: { x: -halfW, y: -halfH },
    ne: { x: halfW, y: -halfH },
    se: { x: halfW, y: halfH },
    sw: { x: -halfW, y: halfH },
  }
  const anchor = locals[TEXT_CORNERS[handle]]
  const dragged = locals[handle]
  const base = Math.max(1, Math.hypot(dragged.x - anchor.x, dragged.y - anchor.y))
  const local = unrotatePoint(point, center, rotation)
  const next = Math.max(8, Math.hypot(local.x - center.x - anchor.x, local.y - center.y - anchor.y))
  const nextFont = Math.max(10, Math.min(240, Math.round(annotation.fontSize * (next / base) * 10) / 10))
  const applied = nextFont / Math.max(1, annotation.fontSize)
  const newW = box.width * applied
  const newH = box.height * applied
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const anchorWorldX = center.x + anchor.x * cos - anchor.y * sin
  const anchorWorldY = center.y + anchor.x * sin + anchor.y * cos
  const newAnchorX = anchor.x * applied
  const newAnchorY = anchor.y * applied
  const nextCenterX = anchorWorldX - (newAnchorX * cos - newAnchorY * sin)
  const nextCenterY = anchorWorldY - (newAnchorX * sin + newAnchorY * cos)
  const scaled: TextAnnotation = {
    ...annotation,
    fontSize: nextFont,
    x: nextCenterX - newW / 2,
    y: nextCenterY - newH / 2,
  }
  if (annotation.width && annotation.width > 0) scaled.width = Math.round(annotation.width * applied * 10) / 10
  if (annotation.height && annotation.height > 0) scaled.height = Math.round(annotation.height * applied * 10) / 10
  return scaled
}

function resizeText(annotation: TextAnnotation, handle: BoxResizeHandle, point: Point, minSize: number): TextAnnotation {
  if (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw') {
    return scaleTextFromCorner(annotation, handle, point)
  }
  const box = getTextBox(annotation)
  const rotation = annotation.rotation ?? 0
  const content = layoutText(annotation)
  const vertical = handle === 'n' || handle === 's'
  const resized = resizeRotatedBox(
    { ...box, rotation },
    handle,
    point,
    vertical ? box.width : Math.max(minSize, annotation.fontSize * 0.8),
    vertical ? content.height : box.height,
  )
  if (vertical) {
    const next: TextAnnotation = {
      ...annotation,
      x: resized.x,
      y: resized.y,
    }
    if (resized.height > content.height + 0.5) next.height = resized.height
    else delete next.height
    return next
  }
  const wrapped = layoutText({ ...annotation, width: resized.width })
  const hugged = boxKeepingTop(
    { x: resized.x, y: resized.y, width: resized.width, height: box.height },
    rotation,
    wrapped.height,
  )
  const next: TextAnnotation = {
    ...annotation,
    x: hugged.x,
    y: hugged.y,
    width: Math.round(resized.width * 10) / 10,
  }
  delete next.height
  return next
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
      if (!isBoxHandle(handle)) return annotation
      const box = resizeRotatedBox(
        { ...annotation, rotation: annotationRotation(annotation) },
        handle,
        point,
        minSize,
        minSize,
      )
      return { ...annotation, ...box }
    }
    case 'line':
    case 'arrow': {
      if (handle === 'start') return { ...annotation, x1: point.x, y1: point.y }
      if (handle === 'end') return { ...annotation, x2: point.x, y2: point.y }
      return annotation
    }
    case 'text': {
      if (!isBoxHandle(handle)) return annotation
      return resizeText(annotation, handle, point, minSize)
    }
    case 'marker':
    case 'pen':
      return annotation
  }
}

export function rotateAnnotation(annotation: ImageAnnotation, start: Point, point: Point): ImageAnnotation {
  if (annotation.kind !== 'rect' && annotation.kind !== 'ellipse' && annotation.kind !== 'text') return annotation
  const frame = annotationFrame(annotation)
  if (!frame) return annotation
  const center = boxCenter(frame)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const nextAngle = Math.atan2(point.y - center.y, point.x - center.x)
  return {
    ...annotation,
    rotation: normalizeAngle((annotation.rotation ?? 0) + (nextAngle - startAngle)),
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
