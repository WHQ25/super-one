import { describe, expect, it } from 'vitest'
import {
  clearHistory,
  createHistoryState,
  defaultMarkerRadius,
  findTopmostAnnotationAt,
  getAnnotationHandles,
  hitTestAnnotation,
  hitTestHandle,
  hitTestOcrRegion,
  isOcrRegionRedacted,
  moveAnnotation,
  nextMarkerNumber,
  normalizeBox,
  pushHistory,
  redactAllOcrRegions,
  redoHistory,
  resizeAnnotation,
  toggleOcrRegionMosaic,
  undoHistory,
  updateAnnotationStyle,
  type BoxShapeAnnotation,
  type LineShapeAnnotation,
  type MarkerAnnotation,
  type OcrTextRegion,
  type PenAnnotation,
  type TextAnnotation,
} from './image-editor-model'

describe('image-editor-model', () => {
  it('supports undo, redo, and clear all history transitions', () => {
    const m1: MarkerAnnotation = {
      id: 'm1',
      kind: 'marker',
      color: '#ef4444',
      strokeWidth: 4,
      number: 1,
      x: 50,
      y: 60,
      radius: 18,
    }
    const m2: MarkerAnnotation = {
      id: 'm2',
      kind: 'marker',
      color: '#3b82f6',
      strokeWidth: 4,
      number: 2,
      x: 100,
      y: 120,
      radius: 18,
    }

    let state = createHistoryState()
    state = pushHistory(state, [m1])
    state = pushHistory(state, [m1, m2])
    expect(state.present).toHaveLength(2)

    state = undoHistory(state)
    expect(state.present).toEqual([m1])

    state = redoHistory(state)
    expect(state.present).toEqual([m1, m2])

    state = clearHistory(state)
    expect(state.present).toEqual([])

    // Undo after clear restores all annotations
    state = undoHistory(state)
    expect(state.present).toEqual([m1, m2])
  })

  it('computes sequential marker numbers based on existing markers', () => {
    expect(nextMarkerNumber([])).toBe(1)
    const m1: MarkerAnnotation = {
      id: 'm1',
      kind: 'marker',
      color: '#ef4444',
      strokeWidth: 4,
      number: 1,
      x: 10,
      y: 10,
      radius: 16,
    }
    const m2: MarkerAnnotation = {
      id: 'm2',
      kind: 'marker',
      color: '#ef4444',
      strokeWidth: 4,
      number: 2,
      x: 30,
      y: 30,
      radius: 16,
    }
    expect(nextMarkerNumber([m1])).toBe(2)
    expect(nextMarkerNumber([m1, m2])).toBe(3)
  })

  it('normalizes boxes and supports hit-testing, moving, and resizing geometric shapes', () => {
    const box = normalizeBox(120, 150, 20, 50)
    expect(box).toEqual({ x: 20, y: 50, width: 100, height: 100 })

    const rect: BoxShapeAnnotation = {
      id: 'r1',
      kind: 'rect',
      color: '#22c55e',
      strokeWidth: 4,
      ...box,
    }

    expect(hitTestAnnotation(rect, { x: 70, y: 100 }, 6)).toBe(true)
    expect(hitTestAnnotation(rect, { x: 5, y: 5 }, 4)).toBe(false)

    const handles = getAnnotationHandles(rect)
    expect(handles).toHaveLength(8)
    expect(hitTestHandle(rect, { x: 120, y: 150 }, 8)).toBe('se')

    const resized = resizeAnnotation(rect, 'se', { x: 220, y: 250 }) as BoxShapeAnnotation
    expect(resized.width).toBe(200)
    expect(resized.height).toBe(200)

    const moved = moveAnnotation(resized, 15, -10) as BoxShapeAnnotation
    expect(moved.x).toBe(35)
    expect(moved.y).toBe(40)
  })

  it('supports hit-testing, moving, and resizing lines, arrows, non-resizable markers, text, and pen strokes', () => {
    const arrow: LineShapeAnnotation = {
      id: 'a1',
      kind: 'arrow',
      color: '#f97316',
      strokeWidth: 4,
      x1: 10,
      y1: 10,
      x2: 110,
      y2: 10,
    }
    expect(hitTestAnnotation(arrow, { x: 60, y: 12 }, 6)).toBe(true)
    expect(hitTestHandle(arrow, { x: 110, y: 10 }, 8)).toBe('end')

    const resizedArrow = resizeAnnotation(arrow, 'end', { x: 150, y: 40 }) as LineShapeAnnotation
    expect(resizedArrow.x2).toBe(150)
    expect(resizedArrow.y2).toBe(40)

    const marker: MarkerAnnotation = {
      id: 'mk1',
      kind: 'marker',
      color: '#ef4444',
      strokeWidth: 4,
      number: 1,
      x: 200,
      y: 200,
      radius: defaultMarkerRadius(4, 1),
    }
    // Step markers do not have drag-to-resize handles, only move and toolbar style updates
    expect(getAnnotationHandles(marker)).toEqual([])
    expect(hitTestHandle(marker, { x: 200 + marker.radius, y: 200 }, 6)).toBeNull()
    const movedMarker = moveAnnotation(marker, 10, -5) as MarkerAnnotation
    expect(movedMarker.x).toBe(210)
    expect(movedMarker.y).toBe(195)

    const textAnn: TextAnnotation = {
      id: 't1',
      kind: 'text',
      color: '#eab308',
      strokeWidth: 4,
      x: 50,
      y: 80,
      text: 'Hello',
      fontSize: 24,
    }
    expect(hitTestAnnotation(textAnn, { x: 60, y: 90 }, 6)).toBe(true)
    const textHandles = getAnnotationHandles(textAnn)
    expect(textHandles).toHaveLength(1)
    expect(textHandles[0]?.handle).toBe('scale')
    const scaledText = resizeAnnotation(textAnn, 'scale', { x: 200, y: 140 }) as TextAnnotation
    expect(scaledText.fontSize).toBeGreaterThan(24)

    const pen: PenAnnotation = {
      id: 'p1',
      kind: 'pen',
      color: '#a855f7',
      strokeWidth: 6,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
    }
    expect(hitTestAnnotation(pen, { x: 25, y: 2 }, 6)).toBe(true)
    expect(findTopmostAnnotationAt([arrow, marker, pen], { x: 200, y: 200 }, 6)?.id).toBe('mk1')

    const restyled = updateAnnotationStyle(marker, { color: '#3b82f6', strokeWidth: 8, imageScale: 1 }) as MarkerAnnotation
    expect(restyled.color).toBe('#3b82f6')
    expect(restyled.strokeWidth).toBe(8)
  })

  it('toggles OCR text region mosaic and redacts all OCR regions', () => {
    const regions: OcrTextRegion[] = [
      { text: 'secret@example.com', confidence: 0.98, x: 40, y: 50, width: 120, height: 24 },
      { text: 'API_KEY_12345', confidence: 0.95, x: 40, y: 100, width: 140, height: 24 },
    ]

    const hit = hitTestOcrRegion(regions, { x: 60, y: 60 })
    expect(hit?.text).toBe('secret@example.com')

    let seq = 0
    const nextId = () => `mosaic-${++seq}`

    // Click once to redact the first OCR text box
    let annotations = toggleOcrRegionMosaic([], regions[0]!, 400, 300, nextId)
    expect(annotations).toHaveLength(1)
    expect(isOcrRegionRedacted(annotations, regions[0]!)).toBe(true)
    expect(isOcrRegionRedacted(annotations, regions[1]!)).toBe(false)

    // Click again on the same OCR box to un-redact it
    annotations = toggleOcrRegionMosaic(annotations, regions[0]!, 400, 300, nextId)
    expect(annotations).toHaveLength(0)

    // Redact all OCR regions in one click
    annotations = redactAllOcrRegions(annotations, regions, 400, 300, nextId)
    expect(annotations).toHaveLength(2)
    expect(isOcrRegionRedacted(annotations, regions[0]!)).toBe(true)
    expect(isOcrRegionRedacted(annotations, regions[1]!)).toBe(true)
  })
})
