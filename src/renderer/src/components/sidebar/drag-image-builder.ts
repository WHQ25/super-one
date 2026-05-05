const FILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(220,220,220)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
const FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(220,220,220)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`

let fileIcon: HTMLImageElement | null = null
let folderIcon: HTMLImageElement | null = null

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err) }
    img.src = url
  })
}

export function preloadDragIcons(): void {
  if (!fileIcon) loadSvg(FILE_SVG).then((img) => { fileIcon = img }).catch(() => {})
  if (!folderIcon) loadSvg(FOLDER_SVG).then((img) => { folderIcon = img }).catch(() => {})
}

export function loadIconFromSvgElement(svgEl: SVGElement): HTMLImageElement {
  const clone = svgEl.cloneNode(true) as SVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const svgString = new XMLSerializer().serializeToString(clone)
  const dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
  const img = new Image()
  img.src = dataURL
  return img
}

export interface DragImageData {
  buffer: ArrayBuffer
  width: number
  height: number
  scaleFactor: number
}

export function buildDragImagePng(name: string, isDirectory: boolean, customIcon?: HTMLImageElement | null): DragImageData | null {
  const fallback = isDirectory ? folderIcon : fileIcon
  const icon = (customIcon && customIcon.complete && customIcon.naturalWidth > 0) ? customIcon : fallback
  if (!icon || !icon.complete || icon.naturalWidth === 0) return null

  const ICON_SIZE = 18
  const PAD_X = 12
  const PAD_Y = 8
  const GAP = 6
  const FONT = '13px -apple-system, system-ui, sans-serif'
  const MAX_TEXT_WIDTH = 220
  const dpr = Math.max(1, window.devicePixelRatio || 1)

  const measureCanvas = document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d')
  if (!mctx) return null
  mctx.font = FONT

  let display = name
  let textWidth = mctx.measureText(name).width
  if (textWidth > MAX_TEXT_WIDTH) {
    while (mctx.measureText(display + '…').width > MAX_TEXT_WIDTH && display.length > 1) {
      display = display.slice(0, -1)
    }
    display += '…'
    textWidth = mctx.measureText(display).width
  }

  const width = PAD_X * 2 + ICON_SIZE + GAP + Math.ceil(textWidth)
  const height = PAD_Y * 2 + ICON_SIZE

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)

  ctx.fillStyle = 'rgba(40,40,40,0.92)'
  ctx.beginPath()
  const r = 6
  ctx.moveTo(r, 0)
  ctx.lineTo(width - r, 0)
  ctx.quadraticCurveTo(width, 0, width, r)
  ctx.lineTo(width, height - r)
  ctx.quadraticCurveTo(width, height, width - r, height)
  ctx.lineTo(r, height)
  ctx.quadraticCurveTo(0, height, 0, height - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fill()

  ctx.drawImage(icon, PAD_X, (height - ICON_SIZE) / 2, ICON_SIZE, ICON_SIZE)

  ctx.fillStyle = 'rgb(245,245,245)'
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  ctx.fillText(display, PAD_X + ICON_SIZE + GAP, height / 2)

  const dataURL = canvas.toDataURL('image/png')
  const base64 = dataURL.split(',')[1]
  if (!base64) return null
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return { buffer: bytes.buffer, width: canvas.width, height: canvas.height, scaleFactor: dpr }
}
