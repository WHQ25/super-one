import {
  annotationRotation,
  annotationFrame,
  rotatePoint,
  getAnnotationHandles,
  getTextBox,
  isOcrRegionRedacted,
  layoutText,
  ROTATE_HANDLE_GAP,
  scaleForImage,
  textFont,
  type BoxRect,
  type ImageAnnotation,
  type MosaicAnnotation,
  type OcrTextRegion,
} from './image-editor-model'

export interface RenderCanvasOptions {
  /** Visible/exported rectangle in original image coordinates. */
  viewport?: BoxRect
  backgroundColor?: string
  interactive?: boolean
  selectedId?: string | null
  editingTextId?: string | null
  draftAnnotation?: ImageAnnotation | null
  ocrRegions?: readonly OcrTextRegion[]
  showOcrBoxes?: boolean
  hoveredOcrKey?: string | null
  /** Physical backing-store pixels per logical image pixel (HiDPI / supersampling). */
  backingScale?: number
  /** Logical image pixels per screen CSS pixel, so selection handles and dashed outlines stay crisp and uniform on screen. */
  uiScale?: number
}

/**
 * Compute a HiDPI / supersampled backing scale for the interactive canvas so
 * vector annotations, text, step markers, and selection handles are always
 * rasterized at physical Retina screen resolution even on low-res images or when zoomed in.
 */
export function computeCanvasBackingScale(
  imageWidth: number,
  imageHeight: number,
  cssWidth?: number,
  zoom = 1,
  devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2,
): number {
  const longSide = Math.max(1, imageWidth, imageHeight)
  const dpr = Math.max(2, devicePixelRatio)
  const effectiveCssWidth = cssWidth && cssWidth > 0 ? cssWidth : imageWidth
  const screenToImageRatio = (effectiveCssWidth * Math.max(1, zoom)) / Math.max(1, imageWidth)
  const minLongSidePixels = 2200 * Math.min(2, Math.max(1, zoom))
  const desired = Math.min(6, Math.max(dpr, screenToImageRatio * dpr, minLongSidePixels / longSide))
  const maxAllowed = 4800 / longSide
  // A viewport can span many image pixels when zoomed out; allow downsampling
  // rather than allocating an image-sized (or larger) screen canvas.
  return Math.min(desired, maxAllowed)
}

function drawMosaicRect(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  ann: MosaicAnnotation,
  backingScale = 1,
): void {
  const rx = Math.max(0, Math.floor(ann.x))
  const ry = Math.max(0, Math.floor(ann.y))
  const rw = Math.min(canvasWidth, Math.ceil(ann.x + ann.width)) - rx
  const rh = Math.min(canvasHeight, Math.ceil(ann.y + ann.height)) - ry
  if (rw <= 0 || rh <= 0) return

  const blockSize = Math.max(8, Math.round(Math.min(canvasWidth, canvasHeight) / 55))

  try {
    const transform = ctx.getTransform?.()
    const pxX = Math.max(0, Math.floor(rx * backingScale + (transform?.e ?? 0)))
    const pxY = Math.max(0, Math.floor(ry * backingScale + (transform?.f ?? 0)))
    const maxPxW = (ctx.canvas?.width || Math.ceil(canvasWidth * backingScale)) - pxX
    const maxPxH = (ctx.canvas?.height || Math.ceil(canvasHeight * backingScale)) - pxY
    const pxW = Math.max(1, Math.min(maxPxW, Math.ceil(rw * backingScale)))
    const pxH = Math.max(1, Math.min(maxPxH, Math.ceil(rh * backingScale)))
    const imgData = ctx.getImageData(pxX, pxY, pxW, pxH)
    const data = imgData.data
    for (let by = 0; by < rh; by += blockSize) {
      for (let bx = 0; bx < rw; bx += blockSize) {
        const sx = Math.min(pxW - 1, Math.floor(Math.min(rw - 1, bx + Math.floor(blockSize / 2)) * backingScale))
        const sy = Math.min(pxH - 1, Math.floor(Math.min(rh - 1, by + Math.floor(blockSize / 2)) * backingScale))
        const idx = (sy * pxW + sx) * 4
        const r = data[idx] ?? 128
        const g = data[idx + 1] ?? 128
        const b = data[idx + 2] ?? 128
        const a = (data[idx + 3] ?? 255) / 255
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`
        ctx.fillRect(
          rx + bx,
          ry + by,
          Math.min(blockSize, rw - bx),
          Math.min(blockSize, rh - by),
        )
      }
    }
  } catch {
    // Fallback checkerboard if canvas pixel read is unavailable in a test environment
    for (let by = 0; by < rh; by += blockSize) {
      for (let bx = 0; bx < rw; bx += blockSize) {
        const even = ((Math.floor(bx / blockSize) + Math.floor(by / blockSize)) % 2) === 0
        ctx.fillStyle = even ? '#64748b' : '#475569'
        ctx.fillRect(
          rx + bx,
          ry + by,
          Math.min(blockSize, rw - bx),
          Math.min(blockSize, rh - by),
        )
      }
    }
  }
}

/** Arrow head length in image pixels. Fixed for a stroke size; only shrinks on a very short shaft. */
export function arrowHeadLength(length: number, lineWidth: number, imageScale: number): number {
  const size = Math.max(26 * imageScale, lineWidth * 5)
  return Math.min(length * 0.42, size)
}

function withLocalRotation(
  ctx: CanvasRenderingContext2D,
  box: BoxRect,
  rotation: number,
  draw: () => void,
): void {
  ctx.save()
  if (rotation) {
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    ctx.translate(cx, cy)
    ctx.rotate(rotation)
    ctx.translate(-cx, -cy)
  }
  draw()
  ctx.restore()
}

function drawAnnotationItem(
  ctx: CanvasRenderingContext2D,
  ann: ImageAnnotation,
  imageScale: number,
  canvasWidth: number,
  canvasHeight: number,
  backingScale = 1,
): void {
  ctx.save()
  switch (ann.kind) {
    case 'mosaic': {
      drawMosaicRect(ctx, canvasWidth, canvasHeight, ann, backingScale)
      break
    }
    case 'pen': {
      const pts = ann.points
      if (pts.length === 0) break
      const lineWidth = Math.max(1.5, ann.strokeWidth * imageScale)
      ctx.strokeStyle = ann.color
      ctx.fillStyle = ann.color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pts.length === 1) {
        ctx.beginPath()
        ctx.arc(pts[0]!.x, pts[0]!.y, lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      ctx.beginPath()
      ctx.moveTo(pts[0]!.x, pts[0]!.y)
      for (let i = 1; i < pts.length - 1; i++) {
        const curr = pts[i]!
        const next = pts[i + 1]!
        const midX = (curr.x + next.x) / 2
        const midY = (curr.y + next.y) / 2
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY)
      }
      const last = pts[pts.length - 1]!
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
      break
    }
    case 'rect': {
      const lineWidth = Math.max(1.5, ann.strokeWidth * imageScale)
      withLocalRotation(ctx, ann, ann.rotation ?? 0, () => {
        ctx.strokeStyle = ann.color
        ctx.lineWidth = lineWidth
        ctx.lineJoin = 'round'
        ctx.strokeRect(ann.x, ann.y, ann.width, ann.height)
      })
      break
    }
    case 'ellipse': {
      const lineWidth = Math.max(1.5, ann.strokeWidth * imageScale)
      withLocalRotation(ctx, ann, ann.rotation ?? 0, () => {
        ctx.strokeStyle = ann.color
        ctx.lineWidth = lineWidth
        ctx.beginPath()
        ctx.ellipse(
          ann.x + ann.width / 2,
          ann.y + ann.height / 2,
          Math.max(1, ann.width / 2),
          Math.max(1, ann.height / 2),
          0,
          0,
          Math.PI * 2,
        )
        ctx.stroke()
      })
      break
    }
    case 'line': {
      const lineWidth = Math.max(1.5, ann.strokeWidth * imageScale)
      ctx.strokeStyle = ann.color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ann.x1, ann.y1)
      ctx.lineTo(ann.x2, ann.y2)
      ctx.stroke()
      break
    }
    case 'arrow': {
      const lineWidth = Math.max(1.5, ann.strokeWidth * imageScale)
      const dx = ann.x2 - ann.x1
      const dy = ann.y2 - ann.y1
      const len = Math.hypot(dx, dy)
      if (len < 1) break
      const angle = Math.atan2(dy, dx)
      const headLen = arrowHeadLength(len, lineWidth, imageScale)
      const headAngle = Math.PI / 6.2
      const shaftEndX = ann.x2 - Math.cos(angle) * (headLen * 0.72)
      const shaftEndY = ann.y2 - Math.sin(angle) * (headLen * 0.72)

      ctx.strokeStyle = ann.color
      ctx.fillStyle = ann.color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(ann.x1, ann.y1)
      ctx.lineTo(shaftEndX, shaftEndY)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(ann.x2, ann.y2)
      ctx.lineTo(
        ann.x2 - headLen * Math.cos(angle - headAngle),
        ann.y2 - headLen * Math.sin(angle - headAngle),
      )
      ctx.lineTo(
        ann.x2 - headLen * 0.72 * Math.cos(angle),
        ann.y2 - headLen * 0.72 * Math.sin(angle),
      )
      ctx.lineTo(
        ann.x2 - headLen * Math.cos(angle + headAngle),
        ann.y2 - headLen * Math.sin(angle + headAngle),
      )
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'text': {
      const layout = layoutText(ann)
      const box = getTextBox(ann)
      withLocalRotation(ctx, box, ann.rotation ?? 0, () => {
        ctx.font = textFont(layout.fontSize)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        const isDarkText = ann.color.toLowerCase() === '#18181b'
        ctx.strokeStyle = isDarkText ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.65)'
        ctx.lineWidth = Math.max(1.5, layout.fontSize * 0.11)
        ctx.fillStyle = ann.color
        for (let i = 0; i < layout.lines.length; i++) {
          const lineY = ann.y + (i + 0.5) * layout.lineHeight
          if (typeof ctx.strokeText === 'function') ctx.strokeText(layout.lines[i]!, ann.x, lineY)
          ctx.fillText(layout.lines[i]!, ann.x, lineY)
        }
      })
      break
    }
    case 'marker': {
      const r = Math.max(8, ann.radius)
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
      ctx.shadowBlur = Math.max(2, 4 * imageScale) * backingScale
      ctx.shadowOffsetY = Math.max(1, 1.5 * imageScale) * backingScale

      ctx.fillStyle = ann.color
      ctx.beginPath()
      ctx.arc(ann.x, ann.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      ctx.strokeStyle = ann.color.toLowerCase() === '#ffffff' ? '#18181b' : '#ffffff'
      ctx.lineWidth = Math.max(1.2, 2.1 * imageScale)
      ctx.beginPath()
      ctx.arc(ann.x, ann.y, r, 0, Math.PI * 2)
      ctx.stroke()

      const isLightFill = ann.color.toLowerCase() === '#ffffff' || ann.color.toLowerCase() === '#eab308'
      ctx.fillStyle = isLightFill ? '#18181b' : '#ffffff'
      const fontSize = Math.round(r * 1.12 * 10) / 10
      ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(ann.number), ann.x, ann.y + fontSize * 0.04)
      break
    }
  }
  ctx.restore()
}

function drawCornerSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  uiScale: number,
  backingScale: number,
): void {
  const size = 9 * uiScale
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
  ctx.shadowBlur = 2.5 * uiScale * backingScale
  ctx.shadowOffsetY = 0.75 * uiScale * backingScale
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x - size / 2, y - size / 2, size, size)
  ctx.restore()
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1.5 * uiScale
  ctx.strokeRect(x - size / 2, y - size / 2, size, size)
}

function drawRotateKnob(
  ctx: CanvasRenderingContext2D,
  box: BoxRect,
  uiScale: number,
  backingScale: number,
): void {
  const hx = box.x + box.width / 2
  const hy = box.y - ROTATE_HANDLE_GAP * uiScale
  const radius = 5.5 * uiScale
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
  ctx.shadowBlur = 2.5 * uiScale * backingScale
  ctx.shadowOffsetY = 0.75 * uiScale * backingScale
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(hx, hy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1.75 * uiScale
  ctx.beginPath()
  ctx.arc(hx, hy, radius, 0, Math.PI * 2)
  ctx.stroke()
}

function drawEndpointHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  uiScale: number,
  backingScale: number,
): void {
  const radius = 4.5 * uiScale
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
  ctx.shadowBlur = 2.5 * uiScale * backingScale
  ctx.shadowOffsetY = 0.75 * uiScale * backingScale
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1.75 * uiScale
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
}

function drawBoxChrome(
  ctx: CanvasRenderingContext2D,
  box: BoxRect,
  rotation: number,
  uiScale: number,
  backingScale: number,
  withRotate: boolean,
): void {
  withLocalRotation(ctx, box, rotation, () => {
    const dashUnit = 4.5 * uiScale
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1.5 * uiScale
    ctx.setLineDash([dashUnit, dashUnit * 0.85])
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    ctx.setLineDash([])
    drawCornerSquare(ctx, box.x, box.y, uiScale, backingScale)
    drawCornerSquare(ctx, box.x + box.width, box.y, uiScale, backingScale)
    drawCornerSquare(ctx, box.x + box.width, box.y + box.height, uiScale, backingScale)
    drawCornerSquare(ctx, box.x, box.y + box.height, uiScale, backingScale)
    if (withRotate) drawRotateKnob(ctx, box, uiScale, backingScale)
  })
}

function drawSelectionChrome(
  ctx: CanvasRenderingContext2D,
  ann: ImageAnnotation,
  uiScale: number,
  backingScale = 1,
): void {
  ctx.save()
  if (ann.kind === 'rect' || ann.kind === 'ellipse' || ann.kind === 'mosaic') {
    drawBoxChrome(ctx, ann, annotationRotation(ann), uiScale, backingScale, ann.kind !== 'mosaic')
  } else if (ann.kind === 'text') {
    drawBoxChrome(ctx, getTextBox(ann), ann.rotation ?? 0, uiScale, backingScale, true)
  } else if (ann.kind === 'marker') {
    const dashUnit = 4.5 * uiScale
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1.5 * uiScale
    ctx.setLineDash([dashUnit, dashUnit * 0.85])
    ctx.beginPath()
    ctx.arc(ann.x, ann.y, ann.radius + 3 * uiScale, 0, Math.PI * 2)
    ctx.stroke()
  } else if (ann.kind === 'pen' && ann.points.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const pt of ann.points) {
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
    const dashUnit = 4.5 * uiScale
    const pad = 6 * uiScale
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1.5 * uiScale
    ctx.setLineDash([dashUnit, dashUnit * 0.85])
    ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2)
  } else if (ann.kind === 'line' || ann.kind === 'arrow') {
    for (const handle of getAnnotationHandles(ann, uiScale)) {
      drawEndpointHandle(ctx, handle.x, handle.y, uiScale, backingScale)
    }
  }
  ctx.restore()
}

function drawOcrBoxes(
  ctx: CanvasRenderingContext2D,
  regions: readonly OcrTextRegion[],
  annotations: readonly ImageAnnotation[],
  uiScale: number,
  hoveredOcrKey?: string | null,
): void {
  ctx.save()
  const dash = 4 * uiScale
  for (const region of regions) {
    const redacted = isOcrRegionRedacted(annotations, region)
    const key = `${Math.round(region.x)}:${Math.round(region.y)}:${Math.round(region.width)}:${Math.round(region.height)}`
    const hovered = hoveredOcrKey === key
    ctx.setLineDash([dash, dash])
    ctx.lineWidth = (hovered ? 2.2 : 1.5) * uiScale
    ctx.strokeStyle = redacted
      ? 'rgba(34, 197, 94, 0.85)'
      : hovered
        ? 'rgba(245, 158, 11, 1)'
        : 'rgba(59, 130, 246, 0.85)'
    ctx.fillStyle = redacted
      ? 'rgba(34, 197, 94, 0.08)'
      : hovered
        ? 'rgba(245, 158, 11, 0.22)'
        : 'rgba(59, 130, 246, 0.12)'
    ctx.fillRect(region.x - 2, region.y - 2, region.width + 4, region.height + 4)
    ctx.strokeRect(region.x - 2, region.y - 2, region.width + 4, region.height + 4)
  }
  ctx.restore()
}

/** Include painted geometry, excluding selection handles and OCR overlays. */
export function annotatedImageBounds(
  width: number,
  height: number,
  annotations: readonly ImageAnnotation[],
): BoxRect {
  let left = 0
  let top = 0
  let right = width
  let bottom = height
  const imageScale = scaleForImage(width, height)
  const include = (x: number, y: number, padding: number) => {
    left = Math.min(left, x - padding)
    top = Math.min(top, y - padding)
    right = Math.max(right, x + padding)
    bottom = Math.max(bottom, y + padding)
  }
  for (const ann of annotations) {
    // Redaction only affects existing image pixels.
    if (ann.kind === 'mosaic') continue
    const stroke = Math.max(1.5, ann.strokeWidth * imageScale)
    if (ann.kind === 'pen') {
      for (const point of ann.points) include(point.x, point.y, stroke / 2)
    } else if (ann.kind === 'marker') {
      include(ann.x, ann.y, Math.max(8, ann.radius) + Math.max(2, 6 * imageScale))
    } else if (ann.kind === 'line' || ann.kind === 'arrow') {
      include(ann.x1, ann.y1, stroke / 2)
      include(ann.x2, ann.y2, stroke / 2)
      if (ann.kind === 'arrow') {
        const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1)
        const head = arrowHeadLength(Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1), stroke, imageScale)
        for (const side of [-1, 1]) {
          const theta = angle + side * Math.PI / 6.2
          include(ann.x2 - head * Math.cos(theta), ann.y2 - head * Math.sin(theta), stroke / 2)
        }
      }
    } else {
      const frame = annotationFrame(ann)
      if (!frame) continue
      const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
      const padding = ann.kind === 'text' ? Math.max(1.5, ann.fontSize * 0.11) / 2 : stroke / 2
      for (const x of [frame.x, frame.x + frame.width]) {
        for (const y of [frame.y, frame.y + frame.height]) {
          const point = rotatePoint({ x, y }, center, frame.rotation)
          include(point.x, point.y, padding)
        }
      }
    }
  }
  left = Math.floor(left)
  top = Math.floor(top)
  return { x: left, y: top, width: Math.ceil(right) - left, height: Math.ceil(bottom) - top }
}

export function renderAnnotatedCanvas(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  annotations: readonly ImageAnnotation[],
  options: RenderCanvasOptions = {},
): void {
  const width = image.naturalWidth || image.width || ctx.canvas.width
  const height = image.naturalHeight || image.height || ctx.canvas.height
  if (width <= 0 || height <= 0) return

  const backingScale = options.backingScale ?? 1
  const viewport = options.viewport ?? { x: 0, y: 0, width, height }
  const imageScale = scaleForImage(width, height)
  const uiScale = options.uiScale ?? imageScale

  ctx.save()
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(backingScale, 0, 0, backingScale, -viewport.x * backingScale, -viewport.y * backingScale)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.clearRect(viewport.x, viewport.y, viewport.width, viewport.height)
  if (options.backgroundColor) {
    // Fill only the extension, preserving transparency in the original image.
    ctx.fillStyle = options.backgroundColor
    const right = viewport.x + viewport.width
    const bottom = viewport.y + viewport.height
    if (viewport.y < 0) ctx.fillRect(viewport.x, viewport.y, viewport.width, -viewport.y)
    if (bottom > height) ctx.fillRect(viewport.x, height, viewport.width, bottom - height)
    if (viewport.x < 0) ctx.fillRect(viewport.x, 0, -viewport.x, height)
    if (right > width) ctx.fillRect(width, 0, right - width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  const all = options.draftAnnotation ? [...annotations, options.draftAnnotation] : annotations

  // First pass: draw all mosaic regions directly over the base image pixels
  for (const ann of all) {
    if (ann.kind === 'mosaic') {
      drawAnnotationItem(ctx, ann, imageScale, width, height, backingScale)
    }
  }

  // Second pass: draw all vector strokes, shapes, arrows, text, and markers on top
  for (const ann of all) {
    if (ann.kind !== 'mosaic') {
      if (options.interactive && options.editingTextId && ann.id === options.editingTextId) {
        continue
      }
      drawAnnotationItem(ctx, ann, imageScale, width, height, backingScale)
    }
  }

  if (options.interactive) {
    if (options.showOcrBoxes && options.ocrRegions && options.ocrRegions.length > 0) {
      drawOcrBoxes(ctx, options.ocrRegions, annotations, uiScale, options.hoveredOcrKey)
    }
    if (options.selectedId && options.selectedId !== options.editingTextId) {
      const selected = annotations.find((a) => a.id === options.selectedId)
      if (selected) {
        drawSelectionChrome(ctx, selected, uiScale, backingScale)
      }
    }
  }
  ctx.restore()
}

export function exportAnnotatedImage(
  image: HTMLImageElement,
  annotations: readonly ImageAnnotation[],
  mimeType = 'image/png',
  backgroundColor?: string,
): { dataUrl: string; base64: string; mimeType: string } | null {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null

  const viewport = annotatedImageBounds(width, height, annotations)
  const longSide = Math.max(width, height)
  const exportScale = longSide < 1600 ? Math.min(3, Math.max(2, Math.ceil(1600 / longSide))) : 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width * exportScale)
  canvas.height = Math.round(viewport.height * exportScale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  renderAnnotatedCanvas(ctx, image, annotations, { interactive: false, backingScale: exportScale, viewport, backgroundColor })
  try {
    const outMime = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const dataUrl = canvas.toDataURL(outMime)
    const base64 = dataUrl.split(',')[1] ?? ''
    if (!base64) return null
    return { dataUrl, base64, mimeType: outMime }
  } catch {
    return null
  }
}

/** Extract PNG base64 for OCR recognition, downscaling very large 4K+ images for speed and mapping factor back. */
export function extractImageForOcr(
  image: HTMLImageElement,
  maxSide = 2200,
): { base64: string; scale: number } | null {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null

  const longSide = Math.max(width, height)
  const scale = longSide > maxSide ? maxSide / longSide : 1
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(image, 0, 0, targetW, targetH)
  try {
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1] ?? ''
    if (!base64) return null
    return { base64, scale }
  } catch {
    return null
  }
}
