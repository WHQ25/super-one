// The legacy build carries its polyfills: the modern one calls `Promise.try`
// and `Uint8Array.toHex`, which WKWebView lacks before iOS 18.2.
import { GlobalWorkerOptions, RenderingCancelledException, getDocument, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?source'
import cMaps from 'pdfjs-dist/cmaps?inline'
import { readCachedFile, setViewerStatus } from '../viewer-runtime/cached-file'

/** Gap between pages and around them, in CSS px. */
const GAP = 12
/**
 * Pages render this far either side of the screen, in screen heights, and give
 * their bitmap back beyond twice that: a long PDF never holds every page.
 */
const RENDER_AHEAD = 1
/** Rendered above the screen's pixel density, so a pinch-zoom stays readable before it blurs. */
const SHARPNESS = 1.5

// The worker is inlined: the page is offline and has nowhere to fetch it from.
GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })), { type: 'module' })

/**
 * The Adobe CMaps a PDF with a predefined CJK encoding (`UniGB-UCS2-H` and the
 * like) needs to map its text, inlined like the worker and decoded on demand.
 */
class InlineBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base64 = kind === 'cMapUrl' ? cMaps[filename] : undefined
    if (!base64) throw new Error(`No offline ${kind} data for ${filename}`)
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  }
}

interface PageSlot {
  page: PDFPageProxy
  frame: HTMLDivElement
  canvas: HTMLCanvasElement | null
  task: RenderTask | null
}

function pageWidth(): number {
  return document.documentElement.clientWidth - GAP * 2
}

/** Zero-size before dropping: WebKit frees a canvas's backing store only then. */
function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

async function renderSlot(slot: PageSlot): Promise<void> {
  if (slot.canvas || slot.task) return
  const base = slot.page.getViewport({ scale: 1 })
  const scale = (pageWidth() / base.width) * (window.devicePixelRatio || 1) * SHARPNESS
  const viewport = slot.page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const task = slot.page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
  slot.task = task
  try {
    await task.promise
  } catch (error) {
    // Scrolled away mid-render: `releaseSlot` cancelled it and the bitmap goes.
    if (error instanceof RenderingCancelledException) { freeCanvas(canvas); return }
    throw error
  } finally {
    if (slot.task === task) slot.task = null
  }
  slot.frame.replaceChildren(canvas)
  slot.canvas = canvas
}

function releaseSlot(slot: PageSlot): void {
  // A page still rendering is cancelled, or its bitmap would land after it left and stay.
  slot.task?.cancel()
  slot.task = null
  if (!slot.canvas) return
  freeCanvas(slot.canvas)
  slot.frame.replaceChildren()
  slot.canvas = null
}

async function layoutPages(pdf: PDFDocumentProxy, host: HTMLElement): Promise<PageSlot[]> {
  const slots: PageSlot[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const { width, height } = page.getViewport({ scale: 1 })
    const frame = document.createElement('div')
    frame.className = 'page'
    frame.dataset.page = String(number)
    // Sized before it renders, so scrolling and the page counter are right from the start.
    frame.style.aspectRatio = `${width} / ${height}`
    host.appendChild(frame)
    slots.push({ page, frame, canvas: null, task: null })
  }
  return slots
}

function watchPages(slots: PageSlot[], counter: HTMLElement): void {
  const total = slots.length
  const bySlot = new Map(slots.map((slot) => [slot.frame, slot]))
  const near = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = bySlot.get(entry.target as HTMLDivElement)!
      if (entry.isIntersecting) void renderSlot(slot)
    }
  }, { rootMargin: `${RENDER_AHEAD * 100}% 0px` })
  const far = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) releaseSlot(bySlot.get(entry.target as HTMLDivElement)!)
    }
  }, { rootMargin: `${RENDER_AHEAD * 200}% 0px` })
  for (const slot of slots) {
    near.observe(slot.frame)
    far.observe(slot.frame)
  }
  // The page under the middle of the screen: a visibility ratio cannot say,
  // since a zoomed or landscape page is taller than the screen.
  const updateCounter = () => {
    const middle = window.innerHeight / 2
    const index = slots.findIndex((slot) => slot.frame.getBoundingClientRect().bottom >= middle)
    counter.textContent = `${(index < 0 ? total - 1 : index) + 1} / ${total}`
  }
  window.addEventListener('scroll', updateCounter, { passive: true })
  updateCounter()
  counter.hidden = total < 2
}

async function main(): Promise<void> {
  const { uri } = window.viewerTarget
  const data = new Uint8Array(await readCachedFile(uri))
  const pdf = await getDocument({
    data,
    cMapUrl: 'cmaps/',
    cMapPacked: true,
    BinaryDataFactory: InlineBinaryData,
    useWorkerFetch: false,
  }).promise
  const host = document.getElementById('pages')!
  const slots = await layoutPages(pdf, host)
  setViewerStatus('')
  watchPages(slots, document.getElementById('counter')!)
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : ''
  setViewerStatus(name === 'PasswordException'
    ? 'This PDF is password-protected'
    : error instanceof Error ? error.message : String(error))
})
