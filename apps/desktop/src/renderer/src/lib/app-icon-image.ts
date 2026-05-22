const MAC_CANVAS = 1024
const MAC_MARGIN = 100
const MAC_CONTENT = MAC_CANVAS - MAC_MARGIN * 2
const MAC_RADIUS = Math.round(MAC_CONTENT * 0.225)
const PLAIN_SIZE = 512

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): void {
  const scale = Math.max(size / img.width, size / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh)
}

export async function processAppIcon(srcDataUri: string, isMac: boolean): Promise<string> {
  const img = await loadImage(srcDataUri)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return srcDataUri
  if (isMac) {
    canvas.width = MAC_CANVAS
    canvas.height = MAC_CANVAS
    ctx.beginPath()
    ctx.roundRect(MAC_MARGIN, MAC_MARGIN, MAC_CONTENT, MAC_CONTENT, MAC_RADIUS)
    ctx.clip()
    drawCover(ctx, img, MAC_MARGIN, MAC_MARGIN, MAC_CONTENT)
  } else {
    canvas.width = PLAIN_SIZE
    canvas.height = PLAIN_SIZE
    drawCover(ctx, img, 0, 0, PLAIN_SIZE)
  }
  return canvas.toDataURL('image/png')
}
