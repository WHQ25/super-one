/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecognizeImageText, mockWriteImageFile, mockSaveBrowserImage, mockAddImageFromPath, mockAddImageFromBase64 } = vi.hoisted(() => ({
  mockRecognizeImageText: vi.fn(),
  mockWriteImageFile: vi.fn(),
  mockSaveBrowserImage: vi.fn(),
  mockAddImageFromPath: vi.fn(),
  mockAddImageFromBase64: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector: (s: { currentFolder: string }) => unknown) => selector({ currentFolder: '/workspace' }),
    { getState: () => ({ currentFolder: '/workspace' }) },
  ),
  selectEffectiveProjectRoot: () => '/workspace',
}))

vi.mock('../chat-input-api', () => ({
  chatInputAPI: {
    addImageFromPath: mockAddImageFromPath,
    addImageFromBase64: mockAddImageFromBase64,
  },
}))

// Stub window.app before importing components that read window.app.platform at module load
Object.defineProperty(window, 'app', {
  writable: true,
  configurable: true,
  value: {
    platform: 'darwin',
    recognizeImageText: mockRecognizeImageText,
    writeImageFile: mockWriteImageFile,
    saveBrowserImage: mockSaveBrowserImage,
    readFileAsDataUri: vi.fn().mockResolvedValue({ ok: true, dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }),
  },
})

import { ImageAnnotationEditor } from './ImageAnnotationEditor'
import { ImageLightbox } from '../image-lightbox'

class MockImage {
  onload: (() => void) | null = null
  onerror: ((err: unknown) => void) | null = null
  crossOrigin: string | null = null
  naturalWidth = 300
  naturalHeight = 200
  width = 300
  height = 200
  private _src = ''

  set src(val: string) {
    this._src = val
    queueMicrotask(() => {
      this.onload?.()
    })
  }
  get src() {
    return this._src
  }
}

describe('ImageAnnotationEditor & ImageLightbox', () => {
  const originalImage = globalThis.Image

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.Image = MockImage as unknown as typeof Image
    window.Image = MockImage as unknown as typeof Image
    Object.assign(window.app, {
      platform: 'darwin',
      recognizeImageText: mockRecognizeImageText,
      writeImageFile: mockWriteImageFile,
      saveBrowserImage: mockSaveBrowserImage,
      readFileAsDataUri: vi.fn().mockResolvedValue({
        ok: true,
        dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      }),
    })

    // Mock 2D canvas context and toDataURL for jsdom
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        strokeRect: vi.fn(),
        fillRect: vi.fn(),
        ellipse: vi.fn(),
        arc: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        setTransform: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        setLineDash: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(Math.max(4, w * h * 4)),
          width: Math.max(1, w),
          height: Math.max(1, h),
        }),
      } as unknown as CanvasRenderingContext2D
    })

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QU5OT1RBVEVEX1BORw==')

    mockRecognizeImageText.mockResolvedValue({
      ok: true,
      texts: [
        { text: 'Sensitive Token', confidence: 0.99, x: 20, y: 30, width: 100, height: 24 },
      ],
    })
    mockWriteImageFile.mockResolvedValue({ ok: true, savedPath: '/workspace/demo.png' })
    mockSaveBrowserImage.mockResolvedValue({ ok: true, savedPath: '/workspace/copy.png' })
  })

  afterEach(() => {
    cleanup()
    globalThis.Image = originalImage
    vi.restoreAllMocks()
  })

  it('keeps strokes outside the image and expands saved bounds with the preview background', async () => {
    render(<ImageAnnotationEditor src="data:image/png;base64,AAA=" alt="demo.png" onExitEdit={vi.fn()} />)
    const canvas = await screen.findByTestId('image-editor-canvas') as HTMLCanvasElement
    vi.spyOn(screen.getByTestId('image-editor-image-frame'), 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200,
      x: 100, y: 100, toJSON: () => ({}),
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(canvas, { button: 0, clientX: 70, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 440, clientY: 340, pointerId: 1 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 440, clientY: 340, pointerId: 1 })

    fireEvent.click(screen.getByTestId('image-editor-save-as'))
    await waitFor(() => expect(mockSaveBrowserImage).toHaveBeenCalled())
    const exportedCanvas = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances.at(-1)! as HTMLCanvasElement
    expect(exportedCanvas.width).toBeGreaterThan(300 * 3)
    expect(exportedCanvas.height).toBeGreaterThan(200 * 3)
    const exportContext = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results.at(-1)!.value as CanvasRenderingContext2D
    expect(exportContext.moveTo).toHaveBeenCalledWith(-30, -20)
    expect(exportContext.lineTo).toHaveBeenCalledWith(340, 240)
    expect(exportContext.fillRect).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('image-editor-undo'))
    fireEvent.click(screen.getByTestId('image-editor-save-as'))
    await waitFor(() => expect(mockSaveBrowserImage).toHaveBeenCalledTimes(2))
    const originalCanvas = vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.instances.at(-1)! as HTMLCanvasElement
    expect(originalCanvas.width).toBe(900)
    expect(originalCanvas.height).toBe(600)
  })

  it('uses a compact icon for Add to Chat alongside the other toolbar actions', async () => {
    render(<ImageAnnotationEditor src="data:image/png;base64,AAA=" alt="demo.png" onExitEdit={vi.fn()} />)
    await screen.findByTestId('image-editor-canvas')
    const action = screen.getByTestId('image-editor-add-to-chat')
    expect(action.textContent).toBe('')
    expect(action).toHaveAttribute('aria-label', 'chat.imageEditor.addToChat')
    expect(action.querySelector('svg')).toBeTruthy()
  })

  it('places top toolbar, supports sequential markers, undo/redo/clear, and replaces composer attachment on Save', async () => {
    const onReplaceAttachment = vi.fn()
    const onExitEdit = vi.fn()

    render(
      <ImageAnnotationEditor
        src="data:image/png;base64,AAA="
        alt="attachment.png"
        onReplaceAttachment={onReplaceAttachment}
        onExitEdit={onExitEdit}
      />,
    )

    expect(screen.getByTestId('image-editor-toolbar')).toBeTruthy()
    const canvas = await screen.findByTestId('image-editor-canvas')
    vi.spyOn(screen.getByTestId('image-editor-image-frame'), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()

    // Switch to sequential marker tool via keyboard shortcut M
    const markerToolBtn = screen.getByTestId('image-editor-tool-marker')
    fireEvent.keyDown(window, { key: 'm' })
    expect(markerToolBtn.textContent).toBe('1')

    // Click once on canvas to place Marker #1
    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    expect(markerToolBtn.textContent).toBe('2')

    // Click again to place Marker #2
    fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 120, clientY: 80, pointerId: 1 })
    expect(markerToolBtn.textContent).toBe('3')

    // Switch to Text tool via keyboard shortcut T and add a text annotation
    fireEvent.keyDown(window, { key: 't' })
    fireEvent.pointerDown(canvas, { button: 0, clientX: 80, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(canvas, { button: 0, clientX: 80, clientY: 100, pointerId: 1 })

    const textInput = await screen.findByTestId('image-editor-text-input')
    fireEvent.change(textInput, { target: { value: 'Check this button' } })
    fireEvent.keyDown(textInput, { key: 'Enter' })
    expect(screen.getByTestId('image-editor-text-input')).toBe(textInput)
    fireEvent.keyDown(textInput, { key: 'Escape' })
    expect(screen.queryByTestId('image-editor-text-input')).toBeNull()
    expect(onExitEdit).not.toHaveBeenCalled()

    // Undo and Redo
    fireEvent.click(screen.getByTestId('image-editor-undo'))
    fireEvent.click(screen.getByTestId('image-editor-undo'))
    expect(markerToolBtn.textContent).toBe('2')

    fireEvent.click(screen.getByTestId('image-editor-redo'))
    expect(markerToolBtn.textContent).toBe('3')

    // Save replaces the composer attachment directly
    fireEvent.click(screen.getByTestId('image-editor-save'))
    await waitFor(() => {
      expect(onReplaceAttachment).toHaveBeenCalledWith('QU5OT1RBVEVEX1BORw==', 'image/png')
      expect(onExitEdit).toHaveBeenCalled()
    })
  })

  it('keeps the text field open when the click that places it blurs the field', async () => {
    render(
      <ImageAnnotationEditor
        src="data:image/png;base64,AAA="
        alt="attachment.png"
        onExitEdit={vi.fn()}
      />,
    )

    const canvas = await screen.findByTestId('image-editor-canvas')
    vi.spyOn(screen.getByTestId('image-editor-image-frame'), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()

    const textTool = screen.getByTestId('image-editor-tool-text')
    fireEvent.click(textTool)
    expect(textTool.className).toContain('bg-primary/15')

    fireEvent.pointerDown(canvas, { button: 0, clientX: 80, clientY: 100, pointerId: 1 })
    fireEvent.mouseDown(canvas, { button: 0, clientX: 80, clientY: 100 })
    const textInput = screen.getByTestId('image-editor-text-input')
    // The opening click blurs the field before the user can type.
    fireEvent.blur(textInput)
    expect(screen.getByTestId('image-editor-text-input')).toBe(textInput)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.change(screen.getByTestId('image-editor-text-input'), { target: { value: '标注' } })
    fireEvent.blur(screen.getByTestId('image-editor-text-input'))
    expect(screen.queryByTestId('image-editor-text-input')).toBeNull()
    expect((screen.getByTestId('image-editor-undo') as HTMLButtonElement).disabled).toBe(false)
  })

  it('automatically recognizes text in mosaic tool and redacts clicked or all text boxes', async () => {
    const onExitEdit = vi.fn()
    render(
      <ImageAnnotationEditor
        src="data:image/png;base64,AAA="
        alt="screenshot.png"
        filePath="/workspace/screenshot.png"
        onExitEdit={onExitEdit}
      />,
    )

    const canvas = await screen.findByTestId('image-editor-canvas')
    vi.spyOn(screen.getByTestId('image-editor-image-frame'), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()

    fireEvent.click(screen.getByTestId('image-editor-tool-mosaic'))

    await waitFor(() => {
      expect(mockRecognizeImageText).toHaveBeenCalled()
    })

    // Redact All button appears once OCR finds text regions
    const redactAllBtn = await screen.findByTestId('image-editor-redact-all-ocr')
    fireEvent.click(redactAllBtn)

    // Clear button should now be enabled because redaction added a mosaic annotation
    const clearBtn = screen.getByTestId('image-editor-clear') as HTMLButtonElement
    expect(clearBtn.disabled).toBe(false)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExitEdit).not.toHaveBeenCalled()
    expect(screen.getByTestId('image-editor-tool-select').className).toContain('bg-primary/15')
    expect(screen.getByTestId('image-editor-tool-mosaic').className).not.toContain('bg-primary/15')
  })

  it('supports entering edit mode from ImageLightbox and ⌘↵ shortcut to add image file to chat', async () => {
    const onOpenChange = vi.fn()
    render(
      <ImageLightbox
        src="local-file:///workspace/photo.png"
        alt="photo.png"
        filePath="/workspace/photo.png"
        fileName="photo.png"
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    // Pressing ⌘↵ in fullscreen preview adds the image file to chat
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mockAddImageFromPath).toHaveBeenCalledWith('/workspace/photo.png')
    })

    // Clicking the Edit button enters edit mode with the top toolbar
    fireEvent.click(screen.getByTestId('image-lightbox-edit-button'))
    expect(await screen.findByTestId('image-editor-toolbar')).toBeTruthy()
  })
})
