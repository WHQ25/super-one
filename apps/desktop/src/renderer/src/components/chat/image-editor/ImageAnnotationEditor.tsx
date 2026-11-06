import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Circle,
  Download,
  Eye,
  EyeOff,
  Grid2x2,
  Loader2,
  MessageSquarePlus,
  Minus,
  MousePointer,
  MoveUpRight,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  ScanText,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { chatInputAPI } from '../chat-input-api'
import {
  clearHistory,
  createHistoryState,
  defaultMarkerRadius,
  defaultTextFontSize,
  EDITOR_COLORS,
  EDITOR_STROKE_WIDTHS,
  EDITOR_TOOL_SHORTCUTS,
  annotationRotation,
  findTopmostAnnotationAt,
  hitTestAnnotation,
  hitTestHandle,
  hitTestOcrRegion,
  layoutText,
  moveAnnotation,
  nextMarkerNumber,
  normalizeBox,
  ocrRegionKey,
  pushHistory,
  redactAllOcrRegions,
  redoHistory,
  resizeAnnotation,
  rotateAnnotation,
  scaleForImage,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  toggleOcrRegionMosaic,
  undoHistory,
  updateAnnotationStyle,
  type BoxRect,
  type EditorTool,
  type ImageAnnotation,
  type OcrTextRegion,
  type Point,
  type ResizeHandle,
  type TextAnnotation,
} from './image-editor-model'
import {
  computeCanvasBackingScale,
  exportAnnotatedImage,
  extractImageForOcr,
  renderAnnotatedCanvas,
} from './image-editor-canvas'

const isWindows = window.app.platform === 'win32'

export interface ImageAnnotationEditorProps {
  src: string
  alt: string
  /** Local file path when the image corresponds to a file on disk. */
  filePath?: string
  /** Suggested file name for Save As or Add to Chat. */
  fileName?: string
  /** Provided when editing a composer image attachment: Save replaces the attachment in place. */
  onReplaceAttachment?: (base64: string, mimeType: string) => Promise<void> | void
  /** Called when a local file or view copy is saved, with the new dataUrl so the preview updates immediately. */
  onSavedImage?: (dataUrl: string, savedPath?: string) => void
  /** Called when exiting edit mode. */
  onExitEdit: () => void
  /** Called when the entire fullscreen preview should close (e.g. after Add to Chat). */
  onCloseViewer?: () => void
}

type InteractionState =
  | {
      mode: 'draw'
      tool: EditorTool
      start: Point
      draft: ImageAnnotation
    }
  | {
      mode: 'move'
      annotationId: string
      start: Point
      initialAnnotation: ImageAnnotation
      moved: boolean
    }
  | {
      mode: 'resize'
      annotationId: string
      handle: ResizeHandle
      start: Point
      initialAnnotation: ImageAnnotation
      resized: boolean
    }
  | {
      mode: 'mosaic-pending'
      start: Point
      startScreen: Point
      draft: ImageAnnotation | null
    }
  | {
      mode: 'pan'
      startScreen: Point
      initialPan: Point
    }

interface EditingTextState {
  /** Identifies this editor session so a blur from the previous field cannot close the next one. */
  sessionId: string
  id?: string
  x: number
  y: number
  value: string
  color: string
  strokeWidth: number
  fontSize: number
  width?: number
  height?: number
  rotation?: number
}

function releasePointerCapture(target: HTMLElement, pointerId: number) {
  try {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  } catch {
    // Synthetic pointer events are not active pointers.
  }
}

function focusMovedToControl(target: EventTarget | null, field: HTMLElement): boolean {
  return target instanceof Element && target !== field && Boolean(target.closest('button, a, input, textarea, label, [role="button"]'))
}

const SHORTCUT_KEY_TO_TOOL: Record<string, EditorTool> = Object.entries(EDITOR_TOOL_SHORTCUTS).reduce(
  (acc, [toolId, key]) => {
    acc[key.toLowerCase()] = toolId as EditorTool
    return acc
  },
  {} as Record<string, EditorTool>,
)

function cursorForHandle(handle: ResizeHandle, rotation = 0): string {
  if (handle === 'rotate') return 'grab'
  if (handle === 'start' || handle === 'end') return 'move'
  const base = handle === 'n' || handle === 's' ? 90 : handle === 'ne' || handle === 'sw' ? 135 : handle === 'e' || handle === 'w' ? 0 : 45
  const deg = (((base + (rotation * 180) / Math.PI) % 180) + 180) % 180
  const snapped = Math.round(deg / 45) % 4
  if (snapped === 0) return 'ew-resize'
  if (snapped === 1) return 'nwse-resize'
  if (snapped === 2) return 'ns-resize'
  return 'nesw-resize'
}

/** Keep line breaks from Enter. Drop a draft that is only spaces. */
function textForCommit(value: string): string {
  const cleaned = value.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
  return cleaned.trim() ? cleaned : ''
}

function textAnnotationFromDraft(draft: EditingTextState, id: string, text: string): TextAnnotation {
  const ann: TextAnnotation = {
    id,
    kind: 'text',
    x: draft.x,
    y: draft.y,
    text,
    color: draft.color,
    strokeWidth: draft.strokeWidth,
    fontSize: draft.fontSize,
  }
  if (draft.width && draft.width > 0) ann.width = draft.width
  if (draft.height && draft.height > 0) ann.height = draft.height
  if (draft.rotation) ann.rotation = draft.rotation
  return ann
}

function editingStateFromText(ann: TextAnnotation): EditingTextState {
  return {
    sessionId: crypto.randomUUID(),
    id: ann.id,
    x: ann.x,
    y: ann.y,
    value: ann.text,
    color: ann.color,
    strokeWidth: ann.strokeWidth,
    fontSize: ann.fontSize,
    width: ann.width,
    height: ann.height,
    rotation: ann.rotation,
  }
}

function resolveSuggestedFileName(alt: string, filePath?: string, fileName?: string): string {
  const raw = fileName || (filePath ? filePath.split(/[/\\]/).pop() : undefined) || alt || 'annotated-image.png'
  const cleaned = raw.trim() || 'annotated-image.png'
  if (/\.(png|jpe?g|webp)$/i.test(cleaned)) {
    return cleaned.replace(/\.(jpe?g|webp)$/i, '.png')
  }
  return `${cleaned.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-').slice(0, 60) || 'annotated-image'}.png`
}

export function ImageAnnotationEditor({
  src,
  alt,
  filePath,
  fileName,
  onReplaceAttachment,
  onSavedImage,
  onExitEdit,
  onCloseViewer,
}: ImageAnnotationEditorProps) {
  const { t } = useTranslation()
  const editorRef = useRef<HTMLDivElement | null>(null)
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [viewport, setViewport] = useState<BoxRect | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<EditorTool>('pen')
  const [color, setColor] = useState<string>(EDITOR_COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState<number>(EDITOR_STROKE_WIDTHS[1])
  const [history, setHistory] = useState(() => createHistoryState())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftAnnotation, setDraftAnnotation] = useState<ImageAnnotation | null>(null)
  const [editingText, setEditingText] = useState<EditingTextState | null>(null)
  const editingTextRef = useRef<EditingTextState | null>(null)
  const textBlurReadyRef = useRef(false)
  editingTextRef.current = editingText
  const [hoverCursor, setHoverCursor] = useState<string>('crosshair')

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [spacePressed, setSpacePressed] = useState(false)
  const [canvasCssScale, setCanvasCssScale] = useState(1)

  // OCR state for mosaic tool
  const [ocrRegions, setOcrRegions] = useState<OcrTextRegion[]>([])
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrDone, setOcrDone] = useState(false)
  const [showOcrBoxes, setShowOcrBoxes] = useState(true)
  const [hoveredOcrKey, setHoveredOcrKey] = useState<string | null>(null)
  const ocrTriggeredRef = useRef(false)

  // Saving state
  const [saving, setSaving] = useState(false)

  const interactionRef = useRef<InteractionState | null>(null)
  const annotations = history.present
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const selectedAnnotation = useMemo(
    () => (selectedId ? annotations.find((a) => a.id === selectedId) ?? null : null),
    [annotations, selectedId],
  )

  const imageScale = useMemo(
    () => (imageEl ? scaleForImage(imageEl.naturalWidth || imageEl.width, imageEl.naturalHeight || imageEl.height) : 1),
    [imageEl],
  )

  const nextMarkerNum = useMemo(() => nextMarkerNumber(annotations), [annotations])

  // Keep image placement independent of annotations, so extending a stroke never
  // moves/rescales the image under the pointer. The canvas covers the entire preview.
  useLayoutEffect(() => {
    const editor = editorRef.current
    const frame = imageFrameRef.current
    if (!editor || !frame || !imageEl) return
    const width = imageEl.naturalWidth || imageEl.width
    const update = () => {
      const rect = frame.getBoundingClientRect()
      const stage = editor.getBoundingClientRect()
      if (rect.width <= 0 || stage.width <= 0 || stage.height <= 0) return
      const scale = rect.width / width
      setCanvasCssScale(scale / zoom)
      setViewport({
        x: (stage.left - rect.left) / scale,
        y: (stage.top - rect.top) / scale,
        width: stage.width / scale,
        height: stage.height / scale,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(editor)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [imageEl, zoom, pan])

  const previewBackground = useCallback(() => {
    return editorRef.current ? getComputedStyle(editorRef.current).backgroundColor : undefined
  }, [])

  const dismissEditingText = useCallback(() => {
    editingTextRef.current = null
    setEditingText(null)
  }, [])

  // Focus after the opening click. Ignore that click's blur until the next turn,
  // or the empty field commits and disappears immediately.
  useLayoutEffect(() => {
    const el = textInputRef.current
    if (!editingText || !el) return
    textBlurReadyRef.current = false
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
    const timer = window.setTimeout(() => {
      textBlurReadyRef.current = true
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editingText?.sessionId])

  const commitEditingText = useCallback((draftText: EditingTextState | null) => {
    if (!draftText || editingTextRef.current?.sessionId !== draftText.sessionId) return
    const trimmed = textForCommit(draftText.value)
    dismissEditingText()
    if (!trimmed) {
      if (draftText.id) {
        setHistory((prev) => pushHistory(prev, prev.present.filter((a) => a.id !== draftText.id)))
        setSelectedId(null)
      }
      return
    }
    const nextAnn = textAnnotationFromDraft(draftText, draftText.id ?? crypto.randomUUID(), trimmed)
    setHistory((prev) => {
      if (draftText.id) {
        const existing = prev.present.find((a) => a.id === draftText.id)
        if (
          existing &&
          existing.kind === 'text' &&
          existing.text === nextAnn.text &&
          existing.x === nextAnn.x &&
          existing.y === nextAnn.y &&
          existing.color === nextAnn.color &&
          existing.fontSize === nextAnn.fontSize &&
          existing.width === nextAnn.width &&
          existing.height === nextAnn.height &&
          existing.rotation === nextAnn.rotation
        ) {
          return prev
        }
        return pushHistory(
          prev,
          prev.present.map((a) => (a.id === draftText.id ? nextAnn : a)),
        )
      }
      return pushHistory(prev, [...prev.present, nextAnn])
    })
    setSelectedId(nextAnn.id)
  }, [dismissEditingText])

  // Load image cleanly so canvas operations (mosaic pixel read + PNG export) are never tainted
  useEffect(() => {
    let cancelled = false
    setImageEl(null)
    setOcrRegions([])
    setOcrDone(false)
    ocrTriggeredRef.current = false

    const loadImg = (url: string, withCors: boolean): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image()
        if (withCors && !url.startsWith('data:') && !url.startsWith('blob:')) {
          img.crossOrigin = 'anonymous'
        }
        img.onload = () => resolve(img)
        img.onerror = (err) => reject(err)
        img.src = url
      })

    const run = async () => {
      try {
        const img = await loadImg(src, true)
        if (!cancelled) setImageEl(img)
      } catch {
        if (filePath && window.app.readFileAsDataUri) {
          const res = await window.app.readFileAsDataUri(filePath)
          if (res.ok && !cancelled) {
            try {
              const img = await loadImg(res.dataUri, false)
              if (!cancelled) setImageEl(img)
              return
            } catch {
              // Fall through
            }
          }
        }
        try {
          const img = await loadImg(src, false)
          if (!cancelled) setImageEl(img)
        } catch {
          // Image failed to load
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [src, filePath])

  // Render canvas whenever image, annotations, draft, selection, zoom, or OCR overlay changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageEl) return
    const width = imageEl.naturalWidth || imageEl.width
    const height = imageEl.naturalHeight || imageEl.height
    if (width <= 0 || height <= 0) return
    const visible = viewport ?? { x: 0, y: 0, width, height }
    const cssWidth = canvas.clientWidth > 0 ? canvas.clientWidth : visible.width
    const backingScale = computeCanvasBackingScale(visible.width, visible.height, cssWidth)
    const targetW = Math.max(1, Math.round(visible.width * backingScale))
    const targetH = Math.max(1, Math.round(visible.height * backingScale))
    if (canvas.width !== targetW) canvas.width = targetW
    if (canvas.height !== targetH) canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const screenWidth = canvas.getBoundingClientRect().width
    const uiScale = visible.width / Math.max(1, screenWidth > 0 ? screenWidth : cssWidth)
    renderAnnotatedCanvas(ctx, imageEl, annotations, {
      interactive: true,
      viewport: visible,
      selectedId,
      draftAnnotation,
      editingTextId: editingText?.id ?? null,
      ocrRegions,
      showOcrBoxes: tool === 'mosaic' && showOcrBoxes,
      hoveredOcrKey: tool === 'mosaic' ? hoveredOcrKey : null,
      backingScale,
      uiScale,
    })
  }, [imageEl, annotations, draftAnnotation, selectedId, editingText?.id, ocrRegions, tool, showOcrBoxes, hoveredOcrKey, zoom, viewport])

  // Run OCR text recognition when switching to mosaic tool (or when user clicks Recognize Text)
  const runOcr = useCallback(async () => {
    if (!imageEl || ocrLoading) return
    if (!window.app.recognizeImageText) {
      setOcrDone(true)
      return
    }
    const extracted = extractImageForOcr(imageEl)
    if (!extracted) {
      setOcrDone(true)
      return
    }
    setOcrLoading(true)
    try {
      const res = await window.app.recognizeImageText(extracted.base64, 0.2)
      if (res.ok) {
        const invScale = 1 / extracted.scale
        const mapped: OcrTextRegion[] = res.texts.map((item) => ({
          text: item.text,
          confidence: item.confidence,
          x: item.x * invScale,
          y: item.y * invScale,
          width: item.width * invScale,
          height: item.height * invScale,
        }))
        setOcrRegions(mapped)
        setShowOcrBoxes(true)
      }
    } catch {
      // Ignore OCR errors; manual rectangle mosaic remains available
    } finally {
      setOcrLoading(false)
      setOcrDone(true)
    }
  }, [imageEl, ocrLoading])

  useEffect(() => {
    if (tool === 'mosaic' && imageEl && !ocrTriggeredRef.current) {
      ocrTriggeredRef.current = true
      void runOcr()
    }
  }, [tool, imageEl, runOcr])

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number): { pt: Point; tolerance: number; uiScale: number } | null => {
      const frame = imageFrameRef.current
      if (!frame || !imageEl) return null
      const rect = frame.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const logicalWidth = imageEl.naturalWidth || imageEl.width
      const logicalHeight = imageEl.naturalHeight || imageEl.height
      const scaleX = logicalWidth / rect.width
      const scaleY = logicalHeight / rect.height
      return {
        pt: {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY,
        },
        tolerance: Math.max(4, 10 * Math.max(scaleX, scaleY)),
        uiScale: logicalWidth / rect.width,
      }
    },
    [imageEl],
  )

  const handleSelectColor = useCallback(
    (nextColor: string) => {
      setColor(nextColor)
      setEditingText((prev) => (prev ? { ...prev, color: nextColor } : null))
      if (selectedId) {
        setHistory((prev) => {
          const target = prev.present.find((a) => a.id === selectedId)
          if (!target || target.kind === 'mosaic' || target.color === nextColor) return prev
          const updated = prev.present.map((a) =>
            a.id === selectedId ? updateAnnotationStyle(a, { color: nextColor, imageScale }) : a,
          )
          return pushHistory(prev, updated)
        })
      }
    },
    [selectedId, imageScale],
  )

  const handleSelectStrokeWidth = useCallback(
    (nextWidth: number) => {
      setStrokeWidth(nextWidth)
      setEditingText((prev) =>
        prev ? { ...prev, strokeWidth: nextWidth, fontSize: defaultTextFontSize(nextWidth, imageScale) } : null,
      )
      if (selectedId) {
        setHistory((prev) => {
          const target = prev.present.find((a) => a.id === selectedId)
          if (!target || target.kind === 'mosaic' || target.strokeWidth === nextWidth) return prev
          const updated = prev.present.map((a) =>
            a.id === selectedId ? updateAnnotationStyle(a, { strokeWidth: nextWidth, imageScale }) : a,
          )
          return pushHistory(prev, updated)
        })
      }
    },
    [selectedId, imageScale],
  )

  const handleUndo = useCallback(() => {
    dismissEditingText()
    setHistory((prev) => undoHistory(prev))
  }, [dismissEditingText])

  const handleRedo = useCallback(() => {
    dismissEditingText()
    setHistory((prev) => redoHistory(prev))
  }, [dismissEditingText])

  const handleClearAll = useCallback(() => {
    dismissEditingText()
    setSelectedId(null)
    setDraftAnnotation(null)
    setHistory((prev) => clearHistory(prev))
  }, [dismissEditingText])

  const handleRedactAllOcr = useCallback(() => {
    if (!imageEl || ocrRegions.length === 0) return
    const width = imageEl.naturalWidth || imageEl.width
    const height = imageEl.naturalHeight || imageEl.height
    setHistory((prev) => {
      const next = redactAllOcrRegions(
        prev.present,
        ocrRegions,
        width,
        height,
        () => crypto.randomUUID(),
      )
      if (next.length === prev.present.length) return prev
      return pushHistory(prev, next)
    })
  }, [imageEl, ocrRegions])

  const getAnnotationsWithPendingText = useCallback((): ImageAnnotation[] => {
    const pendingText = editingText ? textForCommit(editingText.value) : ''
    if (!editingText || !pendingText) return annotations
    const nextAnn = textAnnotationFromDraft(
      editingText,
      editingText.id ?? crypto.randomUUID(),
      pendingText,
    )
    if (editingText.id) {
      return annotations.map((a) => (a.id === editingText.id ? nextAnn : a))
    }
    return [...annotations, nextAnn]
  }, [annotations, editingText])

  const handleSave = useCallback(async () => {
    if (!imageEl || saving) return
    const finalAnnotations = getAnnotationsWithPendingText()
    dismissEditingText()
    const exported = exportAnnotatedImage(imageEl, finalAnnotations, 'image/png', previewBackground())
    if (!exported) {
      toast.error(t('chat.imageEditor.saveFailed', { error: 'Export failed' }))
      return
    }
    setSaving(true)
    try {
      // 1. Composer image attachment: replace attachment directly
      if (onReplaceAttachment) {
        await onReplaceAttachment(exported.base64, exported.mimeType)
        onSavedImage?.(exported.dataUrl)
        toast.success(t('chat.imageEditor.savedAttachment'))
        onExitEdit()
        return
      }
      // 2. Local image file on disk: write back to the file path
      if (filePath && window.app.writeImageFile) {
        const res = await window.app.writeImageFile(filePath, exported.base64)
        if (res.ok) {
          onSavedImage?.(exported.dataUrl, res.savedPath)
          toast.success(t('chat.imageEditor.savedFile'))
          onExitEdit()
          return
        }
      }
      // 3. Fallback: Save As dialog
      const suggested = resolveSuggestedFileName(alt, filePath, fileName)
      const defaultDir = useAppStore.getState().currentFolder ?? undefined
      const res = await window.app.saveBrowserImage(exported.base64, exported.mimeType, suggested, defaultDir)
      if (res.ok) {
        onSavedImage?.(exported.dataUrl, res.savedPath)
        toast.success(t('chat.imageEditor.savedAs', { path: res.savedPath }))
        onExitEdit()
      } else if (!res.canceled && res.error) {
        toast.error(t('chat.imageEditor.saveFailed', { error: res.error }))
      }
    } catch (err) {
      toast.error(t('chat.imageEditor.saveFailed', { error: (err as Error).message }))
    } finally {
      setSaving(false)
    }
  }, [
    imageEl,
    previewBackground,
    saving,
    getAnnotationsWithPendingText,
    dismissEditingText,
    t,
    onReplaceAttachment,
    filePath,
    alt,
    fileName,
    onSavedImage,
    onExitEdit,
  ])

  const handleSaveAs = useCallback(async () => {
    if (!imageEl || saving) return
    const finalAnnotations = getAnnotationsWithPendingText()
    dismissEditingText()
    const exported = exportAnnotatedImage(imageEl, finalAnnotations, 'image/png', previewBackground())
    if (!exported) {
      toast.error(t('chat.imageEditor.saveFailed', { error: 'Export failed' }))
      return
    }
    setSaving(true)
    try {
      const suggested = resolveSuggestedFileName(alt, filePath, fileName)
      const defaultDir = useAppStore.getState().currentFolder ?? undefined
      const res = await window.app.saveBrowserImage(exported.base64, exported.mimeType, suggested, defaultDir)
      if (res.ok) {
        toast.success(t('chat.imageEditor.savedAs', { path: res.savedPath }))
      } else if (!res.canceled && res.error) {
        toast.error(t('chat.imageEditor.saveFailed', { error: res.error }))
      }
    } catch (err) {
      toast.error(t('chat.imageEditor.saveFailed', { error: (err as Error).message }))
    } finally {
      setSaving(false)
    }
  }, [imageEl, previewBackground, saving, getAnnotationsWithPendingText, dismissEditingText, t, alt, filePath, fileName])

  const handleAddToChat = useCallback(async () => {
    if (!imageEl || saving) return
    const finalAnnotations = getAnnotationsWithPendingText()
    dismissEditingText()
    setSaving(true)
    try {
      const suggested = resolveSuggestedFileName(alt, filePath, fileName)
      if (finalAnnotations.length === 0 && filePath && chatInputAPI.addImageFromPath) {
        await chatInputAPI.addImageFromPath(filePath)
        toast.success(t('chat.imageEditor.addedToChat'))
        ;(onCloseViewer ?? onExitEdit)()
        return
      }
      const exported = exportAnnotatedImage(imageEl, finalAnnotations, 'image/png', previewBackground())
      if (!exported) {
        toast.error(t('chat.imageEditor.saveFailed', { error: 'Export failed' }))
        return
      }
      if (chatInputAPI.addImageFromBase64) {
        await chatInputAPI.addImageFromBase64(exported.base64, exported.mimeType, suggested)
        toast.success(t('chat.imageEditor.addedToChat'))
        ;(onCloseViewer ?? onExitEdit)()
      } else if (filePath && chatInputAPI.addImageFromPath) {
        await chatInputAPI.addImageFromPath(filePath)
        toast.success(t('chat.imageEditor.addedToChat'))
        ;(onCloseViewer ?? onExitEdit)()
      }
    } finally {
      setSaving(false)
    }
  }, [imageEl, previewBackground, saving, getAnnotationsWithPendingText, dismissEditingText, alt, filePath, fileName, t, onCloseViewer, onExitEdit])

  // Keyboard shortcuts for tools, Undo, Redo, Save, Save As, Add to Chat, Delete, Space-pan, Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (editingTextRef.current) {
          commitEditingText(editingTextRef.current)
          return
        }
        if (tool === 'mosaic') {
          setTool('select')
          setHoveredOcrKey(null)
          return
        }
        if (selectedId) {
          setSelectedId(null)
          return
        }
        onExitEdit()
        return
      }
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true)
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        e.stopPropagation()
        handleRedo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) void handleSaveAs()
        else void handleSave()
        return
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (onReplaceAttachment) void handleSave()
        else void handleAddToChat()
        return
      }
      if (!mod && !e.altKey) {
        const matchedTool = SHORTCUT_KEY_TO_TOOL[e.key.toLowerCase()]
        if (matchedTool) {
          e.preventDefault()
          e.stopPropagation()
          if (editingTextRef.current) commitEditingText(editingTextRef.current)
          setTool(matchedTool)
          return
        }
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault()
        e.stopPropagation()
        setHistory((prev) => pushHistory(prev, prev.present.filter((a) => a.id !== selectedId)))
        setSelectedId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [
    handleUndo,
    handleRedo,
    handleSave,
    handleSaveAs,
    handleAddToChat,
    onReplaceAttachment,
    selectedId,
    commitEditingText,
    onExitEdit,
    tool,
  ])

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageEl) return
    const mapped = getCanvasPoint(e.clientX, e.clientY)
    if (!mapped) return
    const hit = findTopmostAnnotationAt(annotations, mapped.pt, mapped.tolerance)
    if (hit && hit.kind === 'text') {
      e.stopPropagation()
      setSelectedId(hit.id)
      setColor(hit.color)
      setStrokeWidth(hit.strokeWidth)
      setEditingText(editingStateFromText(hit))
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !imageEl) return
    e.stopPropagation()
    // The same click otherwise focuses the canvas and blurs the text field as it opens.
    if (tool === 'text') e.preventDefault()

    if (editingTextRef.current) {
      commitEditingText(editingTextRef.current)
    }

    e.currentTarget.setPointerCapture(e.pointerId)

    if (spacePressed) {
      interactionRef.current = {
        mode: 'pan',
        startScreen: { x: e.clientX, y: e.clientY },
        initialPan: pan,
      }
      return
    }

    const mapped = getCanvasPoint(e.clientX, e.clientY)
    if (!mapped) return
    const { pt, tolerance, uiScale } = mapped

    // 1. Check resize handles on the currently selected annotation
    if (selectedAnnotation) {
      const handle = hitTestHandle(selectedAnnotation, pt, tolerance * 1.35, uiScale)
      if (handle) {
        interactionRef.current = {
          mode: 'resize',
          annotationId: selectedAnnotation.id,
          handle,
          start: pt,
          initialAnnotation: selectedAnnotation,
          resized: false,
        }
        return
      }
    }

    // 2. If in select tool, or clicking an existing movable shape/marker/text
    if (tool === 'select') {
      const hit = findTopmostAnnotationAt(annotations, pt, tolerance)
      if (hit) {
        setSelectedId(hit.id)
        if (hit.kind !== 'mosaic') {
          setColor(hit.color)
          setStrokeWidth(hit.strokeWidth)
        }
        interactionRef.current = {
          mode: 'move',
          annotationId: hit.id,
          start: pt,
          initialAnnotation: hit,
          moved: false,
        }
      } else {
        setSelectedId(null)
      }
      return
    }

    // Allow direct dragging of an already-selected annotation, or any existing marker/line/arrow/text when clicked directly
    if (
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'line' ||
      tool === 'arrow' ||
      tool === 'marker' ||
      tool === 'text'
    ) {
      const hit = findTopmostAnnotationAt(annotations, pt, tolerance)
      if (
        hit &&
        (hit.id === selectedId ||
          hit.kind === 'marker' ||
          hit.kind === 'line' ||
          hit.kind === 'arrow' ||
          hit.kind === 'text')
      ) {
        setSelectedId(hit.id)
        if (hit.kind !== 'mosaic') {
          setColor(hit.color)
          setStrokeWidth(hit.strokeWidth)
        }
        interactionRef.current = {
          mode: 'move',
          annotationId: hit.id,
          start: pt,
          initialAnnotation: hit,
          moved: false,
        }
        return
      }
    }

    // 3. Tool-specific creation
    if (tool === 'text') {
      releasePointerCapture(e.currentTarget, e.pointerId)
      setSelectedId(null)
      setEditingText({
        sessionId: crypto.randomUUID(),
        x: pt.x,
        y: pt.y,
        value: '',
        color,
        strokeWidth,
        fontSize: defaultTextFontSize(strokeWidth, imageScale),
      })
      return
    }

    if (tool === 'marker') {
      const marker: ImageAnnotation = {
        id: crypto.randomUUID(),
        kind: 'marker',
        color,
        strokeWidth,
        number: nextMarkerNumber(annotations),
        x: pt.x,
        y: pt.y,
        radius: defaultMarkerRadius(strokeWidth, imageScale),
      }
      setHistory((prev) => pushHistory(prev, [...prev.present, marker]))
      setSelectedId(marker.id)
      return
    }

    if (tool === 'mosaic') {
      interactionRef.current = {
        mode: 'mosaic-pending',
        start: pt,
        startScreen: { x: e.clientX, y: e.clientY },
        draft: null,
      }
      return
    }

    if (tool === 'pen') {
      setSelectedId(null)
      const draft: ImageAnnotation = {
        id: crypto.randomUUID(),
        kind: 'pen',
        color,
        strokeWidth,
        points: [pt],
      }
      interactionRef.current = { mode: 'draw', tool, start: pt, draft }
      setDraftAnnotation(draft)
      return
    }

    if (tool === 'rect' || tool === 'ellipse') {
      setSelectedId(null)
      const draft: ImageAnnotation = {
        id: crypto.randomUUID(),
        kind: tool,
        color,
        strokeWidth,
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
      }
      interactionRef.current = { mode: 'draw', tool, start: pt, draft }
      setDraftAnnotation(draft)
      return
    }

    if (tool === 'line' || tool === 'arrow') {
      setSelectedId(null)
      const draft: ImageAnnotation = {
        id: crypto.randomUUID(),
        kind: tool,
        color,
        strokeWidth,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
      }
      interactionRef.current = { mode: 'draw', tool, start: pt, draft }
      setDraftAnnotation(draft)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = interactionRef.current
    if (active) {
      e.stopPropagation()
      if (active.mode === 'pan') {
        const dx = e.clientX - active.startScreen.x
        const dy = e.clientY - active.startScreen.y
        setPan({ x: active.initialPan.x + dx, y: active.initialPan.y + dy })
        return
      }

      const mapped = getCanvasPoint(e.clientX, e.clientY)
      if (!mapped) return
      const { pt } = mapped

      if (active.mode === 'move') {
        const dx = pt.x - active.start.x
        const dy = pt.y - active.start.y
        if (Math.hypot(dx, dy) > 1) active.moved = true
        const movedAnn = moveAnnotation(active.initialAnnotation, dx, dy)
        setHistory((prev) => ({
          ...prev,
          present: prev.present.map((a) => (a.id === active.annotationId ? movedAnn : a)),
        }))
        return
      }

      if (active.mode === 'resize') {
        active.resized = true
        const resizedAnn = active.handle === 'rotate'
          ? rotateAnnotation(active.initialAnnotation, active.start, pt)
          : resizeAnnotation(active.initialAnnotation, active.handle, pt, Math.max(6, 8 * imageScale))
        setHistory((prev) => ({
          ...prev,
          present: prev.present.map((a) => (a.id === active.annotationId ? resizedAnn : a)),
        }))
        return
      }

      if (active.mode === 'mosaic-pending') {
        const screenDist = Math.hypot(e.clientX - active.startScreen.x, e.clientY - active.startScreen.y)
        if (screenDist > 4 || active.draft) {
          const box = normalizeBox(active.start.x, active.start.y, pt.x, pt.y)
          const draft: ImageAnnotation = {
            id: active.draft?.id ?? crypto.randomUUID(),
            kind: 'mosaic',
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          }
          active.draft = draft
          setDraftAnnotation(draft)
        }
        return
      }

      if (active.mode === 'draw') {
        if (active.draft.kind === 'pen') {
          const nextDraft: ImageAnnotation = {
            ...active.draft,
            points: [...active.draft.points, pt],
          }
          active.draft = nextDraft
          setDraftAnnotation(nextDraft)
        } else if (active.draft.kind === 'rect' || active.draft.kind === 'ellipse') {
          const box = normalizeBox(active.start.x, active.start.y, pt.x, pt.y)
          const nextDraft: ImageAnnotation = {
            ...active.draft,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          }
          active.draft = nextDraft
          setDraftAnnotation(nextDraft)
        } else if (active.draft.kind === 'line' || active.draft.kind === 'arrow') {
          const nextDraft: ImageAnnotation = {
            ...active.draft,
            x2: pt.x,
            y2: pt.y,
          }
          active.draft = nextDraft
          setDraftAnnotation(nextDraft)
        }
        return
      }
    }

    // Hover state (no button pressed)
    if (spacePressed) {
      setHoverCursor('grab')
      return
    }
    const mapped = getCanvasPoint(e.clientX, e.clientY)
    if (!mapped) return
    const { pt, tolerance, uiScale } = mapped

    if (selectedAnnotation) {
      const handle = hitTestHandle(selectedAnnotation, pt, tolerance * 1.35, uiScale)
      if (handle) {
        setHoverCursor(cursorForHandle(handle, annotationRotation(selectedAnnotation)))
        setHoveredOcrKey(null)
        return
      }
    }

    if (tool === 'mosaic' && showOcrBoxes && ocrRegions.length > 0) {
      const hitOcr = hitTestOcrRegion(ocrRegions, pt)
      if (hitOcr) {
        setHoveredOcrKey(ocrRegionKey(hitOcr))
        setHoverCursor('pointer')
        return
      }
      setHoveredOcrKey(null)
    }

    if (tool === 'select') {
      const hit = findTopmostAnnotationAt(annotations, pt, tolerance)
      setHoverCursor(hit ? 'move' : 'default')
      return
    }

    if (selectedAnnotation && hitTestAnnotation(selectedAnnotation, pt, tolerance)) {
      setHoverCursor('move')
      return
    }

    setHoverCursor(tool === 'text' ? 'text' : 'crosshair')
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = interactionRef.current
    if (!active) return
    e.stopPropagation()
    interactionRef.current = null

    if (active.mode === 'pan') return

    if (active.mode === 'move') {
      if (active.moved) {
        setHistory((prev) => {
          const current = prev.present
          const beforeMove = current.map((a) => (a.id === active.annotationId ? active.initialAnnotation : a))
          return {
            past: [...prev.past, beforeMove],
            present: current,
            future: [],
          }
        })
      } else if (tool === 'text' && active.initialAnnotation.kind === 'text') {
        setEditingText(editingStateFromText(active.initialAnnotation))
      }
      return
    }

    if (active.mode === 'resize') {
      if (active.resized) {
        setHistory((prev) => {
          const current = prev.present
          const beforeResize = current.map((a) => (a.id === active.annotationId ? active.initialAnnotation : a))
          return {
            past: [...prev.past, beforeResize],
            present: current,
            future: [],
          }
        })
      }
      return
    }

    if (active.mode === 'mosaic-pending') {
      setDraftAnnotation(null)
      if (active.draft && active.draft.kind === 'mosaic' && active.draft.width >= 4 && active.draft.height >= 4) {
        const created = active.draft
        setHistory((prev) => pushHistory(prev, [...prev.present, created]))
        setSelectedId(created.id)
        return
      }
      // Single click in mosaic tool: check OCR text box first, then existing mosaic annotation
      const mapped = getCanvasPoint(e.clientX, e.clientY)
      const clickPt = mapped?.pt ?? active.start
      if (showOcrBoxes && ocrRegions.length > 0 && imageEl) {
        const hitOcr = hitTestOcrRegion(ocrRegions, clickPt)
        if (hitOcr) {
          const width = imageEl.naturalWidth || imageEl.width
          const height = imageEl.naturalHeight || imageEl.height
          setHistory((prev) =>
            pushHistory(
              prev,
              toggleOcrRegionMosaic(prev.present, hitOcr, width, height, () => crypto.randomUUID()),
            ),
          )
          return
        }
      }
      if (mapped) {
        const hit = findTopmostAnnotationAt(annotations, clickPt, mapped.tolerance)
        if (hit && hit.kind === 'mosaic') {
          setSelectedId(hit.id)
          return
        }
      }
      setSelectedId(null)
      return
    }

    if (active.mode === 'draw') {
      const draft = active.draft
      setDraftAnnotation(null)
      if (draft.kind === 'pen') {
        setHistory((prev) => pushHistory(prev, [...prev.present, draft]))
        return
      }
      if (draft.kind === 'rect' || draft.kind === 'ellipse') {
        if (draft.width >= 4 && draft.height >= 4) {
          setHistory((prev) => pushHistory(prev, [...prev.present, draft]))
          setSelectedId(draft.id)
        }
        return
      }
      if (draft.kind === 'line' || draft.kind === 'arrow') {
        if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= 4) {
          setHistory((prev) => pushHistory(prev, [...prev.present, draft]))
          setSelectedId(draft.id)
        }
      }
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      setZoom((z) => Math.max(0.25, Math.min(8, Math.round(z * factor * 100) / 100)))
    }
  }

  const showStyleControls =
    tool === 'pen' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'text' ||
    tool === 'marker' ||
    (selectedAnnotation !== null && selectedAnnotation.kind !== 'mosaic')

  const toolButtons: Array<{ id: EditorTool; icon: React.ReactNode; label: string; shortcut: string }> = [
    {
      id: 'select',
      icon: <MousePointer className="size-4" />,
      label: t('chat.imageEditor.select'),
      shortcut: EDITOR_TOOL_SHORTCUTS.select,
    },
    {
      id: 'pen',
      icon: <Pencil className="size-4" />,
      label: t('chat.imageEditor.pen'),
      shortcut: EDITOR_TOOL_SHORTCUTS.pen,
    },
    {
      id: 'rect',
      icon: <Square className="size-4" />,
      label: t('chat.imageEditor.rect'),
      shortcut: EDITOR_TOOL_SHORTCUTS.rect,
    },
    {
      id: 'ellipse',
      icon: <Circle className="size-4" />,
      label: t('chat.imageEditor.ellipse'),
      shortcut: EDITOR_TOOL_SHORTCUTS.ellipse,
    },
    {
      id: 'line',
      icon: <Minus className="size-4 -rotate-45" />,
      label: t('chat.imageEditor.line'),
      shortcut: EDITOR_TOOL_SHORTCUTS.line,
    },
    {
      id: 'arrow',
      icon: <MoveUpRight className="size-4" />,
      label: t('chat.imageEditor.arrow'),
      shortcut: EDITOR_TOOL_SHORTCUTS.arrow,
    },
    {
      id: 'text',
      icon: <Type className="size-4" />,
      label: t('chat.imageEditor.text'),
      shortcut: EDITOR_TOOL_SHORTCUTS.text,
    },
    {
      id: 'marker',
      icon: (
        <span className="inline-flex size-4.5 items-center justify-center rounded-full border-[1.75px] border-current text-2xs font-bold leading-none tabular-nums">
          {nextMarkerNum}
        </span>
      ),
      label: t('chat.imageEditor.marker'),
      shortcut: EDITOR_TOOL_SHORTCUTS.marker,
    },
    {
      id: 'mosaic',
      icon: <Grid2x2 className="size-4" />,
      label: t('chat.imageEditor.mosaic'),
      shortcut: EDITOR_TOOL_SHORTCUTS.mosaic,
    },
  ]

  const undoShortcut = isWindows ? 'Ctrl+Z' : '⌘Z'
  const redoShortcut = isWindows ? 'Ctrl+Y' : '⌘⇧Z'
  const saveShortcut = isWindows ? 'Ctrl+S' : '⌘S'
  const saveAsShortcut = isWindows ? 'Ctrl+Shift+S' : '⌘⇧S'
  const addToChatShortcut = isWindows ? 'Ctrl+↵' : '⌘↵'

  const imgWidth = imageEl ? imageEl.naturalWidth || imageEl.width || 1 : 1
  const imgHeight = imageEl ? imageEl.naturalHeight || imageEl.height || 1 : 1
  const editingLayout = editingText
    ? layoutText({ text: editingText.value, fontSize: editingText.fontSize, width: editingText.width })
    : null
  const shrinkCaret = Boolean(editingText && !editingText.value && !(editingText.width && editingText.width > 0))
  const editingBoxWidth = editingText && editingLayout
    ? (shrinkCaret ? Math.max(8, editingText.fontSize * 0.35) : editingLayout.width) * canvasCssScale
    : 0
  const editingBoxHeight = editingLayout ? editingLayout.height * canvasCssScale : 0
  const editingFontPx = editingText ? (Math.round(editingText.fontSize * 10) / 10) * canvasCssScale : 0

  return (
    <div
      ref={editorRef}
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-background"
      onWheel={handleWheel}
      data-testid="image-annotation-editor"
    >
      {/* Top Toolbar */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'absolute left-1/2 z-30 flex max-w-[96%] -translate-x-1/2 flex-col items-center gap-1.5',
          isWindows ? 'top-12' : 'top-3',
        )}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="image-editor-toolbar"
      >
        {/* Row 1: Main tools, Undo/Redo/Clear, Save/SaveAs/AddToChat/Exit */}
        <div className="flex max-w-full shrink-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-xl border border-border/60 bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur-md [&>*]:shrink-0">
          {toolButtons.map((item) => (
            <IconButton
              key={item.id}
              size="sm"
              variant="ghost"
              aria-label={item.label}
              tooltip={
                <>
                  <span>{item.label}</span> <CommandShortcut>{item.shortcut}</CommandShortcut>
                </>
              }
              tooltipSide="bottom"
              tooltipSideOffset={4}
              data-testid={`image-editor-tool-${item.id}`}
              className={cn(
                'size-8 rounded-lg',
                tool === item.id && 'bg-primary/15 text-primary ring-1 ring-primary/30',
              )}
              onClick={() => {
                if (editingTextRef.current) commitEditingText(editingTextRef.current)
                setTool(item.id)
              }}
            >
              {item.icon}
            </IconButton>
          ))}

          <div className="mx-1 h-5 w-px bg-border/70" />

          <IconButton
            size="sm"
            variant="ghost"
            disabled={!canUndo}
            aria-label={t('chat.imageEditor.undo')}
            tooltip={
              <>
                <span>{t('chat.imageEditor.undo')}</span> <CommandShortcut>{undoShortcut}</CommandShortcut>
              </>
            }
            tooltipSide="bottom"
            tooltipSideOffset={4}
            data-testid="image-editor-undo"
            className="size-8 rounded-lg disabled:opacity-35"
            onClick={handleUndo}
          >
            <Undo2 className="size-4" />
          </IconButton>

          <IconButton
            size="sm"
            variant="ghost"
            disabled={!canRedo}
            aria-label={t('chat.imageEditor.redo')}
            tooltip={
              <>
                <span>{t('chat.imageEditor.redo')}</span> <CommandShortcut>{redoShortcut}</CommandShortcut>
              </>
            }
            tooltipSide="bottom"
            tooltipSideOffset={4}
            data-testid="image-editor-redo"
            className="size-8 rounded-lg disabled:opacity-35"
            onClick={handleRedo}
          >
            <Redo2 className="size-4" />
          </IconButton>

          <IconButton
            size="sm"
            variant="ghost"
            disabled={annotations.length === 0}
            aria-label={t('chat.imageEditor.clearAll')}
            tooltip={t('chat.imageEditor.clearAll')}
            tooltipSide="bottom"
            tooltipSideOffset={4}
            data-testid="image-editor-clear"
            className="size-8 rounded-lg text-muted-foreground hover:text-destructive disabled:opacity-35"
            onClick={handleClearAll}
          >
            <Trash2 className="size-4" />
          </IconButton>

          <div className="mx-1 h-5 w-px bg-border/70" />

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="xs"
                  disabled={saving || !imageEl}
                  onClick={() => void handleSave()}
                  aria-label={t('chat.imageEditor.save')}
                  data-testid="image-editor-save"
                  className="h-7 gap-1 rounded-lg px-2.5 text-xs font-medium"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  <span>{t('common.save')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <CommandShortcut className="ml-0">{saveShortcut}</CommandShortcut>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <IconButton
            size="sm"
            variant="ghost"
            disabled={saving || !imageEl}
            aria-label={t('chat.imageEditor.saveAs')}
            tooltip={
              <>
                <span>{t('chat.imageEditor.saveAs')}</span> <CommandShortcut>{saveAsShortcut}</CommandShortcut>
              </>
            }
            tooltipSide="bottom"
            tooltipSideOffset={4}
            data-testid="image-editor-save-as"
            className="size-8 rounded-lg"
            onClick={() => void handleSaveAs()}
          >
            <Download className="size-4" />
          </IconButton>

          {!onReplaceAttachment && (
            <IconButton
              size="sm"
              variant="ghost"
              disabled={saving || !imageEl}
              onClick={() => void handleAddToChat()}
              aria-label={t('chat.imageEditor.addToChat')}
              data-testid="image-editor-add-to-chat"
              tooltip={
                <>
                  <span>{t('chat.image.addToChat')}</span> <CommandShortcut>{addToChatShortcut}</CommandShortcut>
                </>
              }
              tooltipSide="bottom"
              tooltipSideOffset={4}
              className="size-8 rounded-lg"
            >
              <MessageSquarePlus className="size-4" />
            </IconButton>
          )}

          <div className="mx-0.5 h-5 w-px bg-border/70" />

          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t('chat.imageEditor.exitEdit')}
            tooltip={
              <>
                <span>{t('chat.imageEditor.exitEdit')}</span> <CommandShortcut>Esc</CommandShortcut>
              </>
            }
            tooltipSide="bottom"
            tooltipSideOffset={4}
            data-testid="image-editor-exit"
            className="size-8 rounded-lg"
            onClick={onExitEdit}
          >
            <X className="size-4" />
          </IconButton>
        </div>

        {/* Row 2: Contextual Style (Color + Stroke Width) OR Mosaic OCR Bar */}
        {showStyleControls && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/90 px-3 py-1.5 shadow-md backdrop-blur-md"
            data-testid="image-editor-style-bar"
          >
            {/* Color Swatches */}
            <div className="flex items-center gap-1.5" role="group" aria-label={t('chat.imageEditor.color')}>
              {EDITOR_COLORS.map((swatch) => {
                const active = color.toLowerCase() === swatch.toLowerCase()
                return (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={swatch}
                    data-testid={`image-editor-color-${swatch}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectColor(swatch)}
                    className={cn(
                      'size-5 rounded-full border transition-transform',
                      swatch === '#ffffff' ? 'border-border' : 'border-black/15',
                      active && 'scale-115 ring-2 ring-primary ring-offset-1 ring-offset-background',
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                )
              })}
              <label
                title={t('chat.imageEditor.customColor')}
                className="relative flex size-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border bg-gradient-to-tr from-red-500 via-green-500 to-blue-500"
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => handleSelectColor(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={t('chat.imageEditor.customColor')}
                />
              </label>
            </div>

            <div className="h-4 w-px bg-border/70" />

            {/* Stroke Widths */}
            <div className="flex items-center gap-1" role="group" aria-label={t('chat.imageEditor.strokeWidth')}>
              {EDITOR_STROKE_WIDTHS.map((w, idx) => {
                const active = strokeWidth === w
                const dotSize = 4 + idx * 3
                return (
                  <button
                    key={w}
                    type="button"
                    aria-label={`${t('chat.imageEditor.strokeWidth')} ${w}`}
                    data-testid={`image-editor-stroke-${w}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectStrokeWidth(w)}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted',
                      active && 'bg-primary/15 text-primary ring-1 ring-primary/30',
                    )}
                  >
                    <span
                      className="rounded-full bg-current"
                      style={{ width: dotSize, height: dotSize }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {tool === 'mosaic' && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-md backdrop-blur-md"
            data-testid="image-editor-ocr-bar"
          >
            {ocrLoading ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('chat.imageEditor.recognizingText')}
              </span>
            ) : ocrRegions.length > 0 ? (
              <>
                <span className="text-muted-foreground">
                  {t('chat.imageEditor.recognizedCount', { count: ocrRegions.length })}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={handleRedactAllOcr}
                  data-testid="image-editor-redact-all-ocr"
                  className="h-6 gap-1 rounded-md px-2 text-xs"
                >
                  <Sparkles className="size-3" />
                  <span>{t('chat.imageEditor.redactAllText')}</span>
                </Button>
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip={t('chat.imageEditor.toggleOcrBoxes')}
                  tooltipSide="bottom"
                  tooltipSideOffset={4}
                  aria-label={t('chat.imageEditor.toggleOcrBoxes')}
                  onClick={() => setShowOcrBoxes((v) => !v)}
                >
                  {showOcrBoxes ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </IconButton>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {ocrDone ? t('chat.imageEditor.noTextRecognized') : t('chat.imageEditor.recognizeText')}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void runOcr()}
                  data-testid="image-editor-recognize-text"
                  className="h-6 gap-1 rounded-md px-2 text-xs"
                >
                  <ScanText className="size-3.5" />
                  <span>{t('chat.imageEditor.recognizeText')}</span>
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Canvas Stage */}
      {imageEl && (
        <canvas
          ref={canvasRef}
          style={{
            cursor: hoverCursor,
          }}
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => {
            if (tool === 'text') e.preventDefault()
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          data-testid="image-editor-canvas"
          className="absolute inset-0 size-full touch-none"
        />
      )}
      <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden px-[5vw] pt-24 pb-14">
        {!imageEl ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            <div className="relative inline-flex max-h-full max-w-full items-center justify-center">
              <div
                ref={imageFrameRef}
                data-testid="image-editor-image-frame"
                style={{
                  width: `min(${imgWidth}px, 90vw, calc((100vh - 9rem) * ${imgWidth / imgHeight}))`,
                  aspectRatio: `${imgWidth} / ${imgHeight}`,
                }}
                className="max-h-[calc(100vh-9rem)] max-w-[90vw]"
              />
              {editingText && editingLayout && (
                <textarea
                  ref={textInputRef}
                  value={editingText.value}
                  data-session={editingText.sessionId}
                  data-testid="image-editor-text-input"
                  aria-label={t('chat.imageEditor.textPlaceholder')}
                  spellCheck={false}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const nextValue = e.target.value
                    setEditingText((prev) => {
                      if (!prev) return null
                      const next = { ...prev, value: nextValue }
                      editingTextRef.current = next
                      return next
                    })
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      commitEditingText(editingTextRef.current)
                    }
                  }}
                  onBlur={(e) => {
                    const fieldSession = e.currentTarget.dataset.session
                    const current = editingTextRef.current
                    if (!current || current.sessionId !== fieldSession) return
                    if (!textBlurReadyRef.current && !focusMovedToControl(e.relatedTarget, e.currentTarget)) {
                      const sessionId = current.sessionId
                      window.requestAnimationFrame(() => {
                        if (editingTextRef.current?.sessionId === sessionId) textInputRef.current?.focus()
                      })
                      return
                    }
                    commitEditingText(current)
                  }}
                  style={{
                    left: `${(editingText.x / imgWidth) * 100}%`,
                    top: `${(editingText.y / imgHeight) * 100}%`,
                    width: editingBoxWidth,
                    height: editingBoxHeight,
                    color: editingText.color,
                    caretColor: editingText.color,
                    fontFamily: TEXT_FONT_FAMILY,
                    fontWeight: 600,
                    fontSize: `${editingFontPx}px`,
                    lineHeight: TEXT_LINE_HEIGHT,
                    padding: 0,
                    margin: 0,
                    border: 'none',
                    background: 'transparent',
                    whiteSpace: editingText.width ? 'pre-wrap' : 'pre',
                    wordBreak: editingText.width ? 'break-all' : 'normal',
                    overflow: 'hidden',
                    transform: editingText.rotation ? `rotate(${editingText.rotation}rad)` : undefined,
                    transformOrigin: 'center center',
                  }}
                  className="pointer-events-auto absolute z-20 resize-none outline-none"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Zoom Controls */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.2) * 100) / 100))}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Zoom out"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <span className="min-w-10 text-center font-mono text-2xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(8, Math.round((z + 0.2) * 100) / 100))}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Zoom in"
        >
          <ZoomIn className="size-3.5" />
        </button>
        <div className="mx-0.5 h-3 w-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Reset zoom"
        >
          <RotateCcw className="size-3" />
        </button>
      </div>
    </div>
  )
}
