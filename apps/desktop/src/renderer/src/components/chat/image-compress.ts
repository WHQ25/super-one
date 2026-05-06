import type { ImageAttachment } from '@superone/shared/agent-types'

const MAX_SIDE = 2000
const JPEG_QUALITY = 0.92

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function buildImageAttachment(file: File, maxSide = MAX_SIDE): Promise<ImageAttachment | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    const base64 = await readAsBase64(file)
    return base64 ? { mimeType: file.type, base64, name: file.name } : null
  }

  const longSide = Math.max(bitmap.width, bitmap.height)
  if (longSide <= maxSide) {
    bitmap.close()
    const base64 = await readAsBase64(file)
    return base64 ? { mimeType: file.type, base64, name: file.name } : null
  }

  const scale = maxSide / longSide
  const targetW = Math.max(1, Math.round(bitmap.width * scale))
  const targetH = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    const base64 = await readAsBase64(file)
    return base64 ? { mimeType: file.type, base64, name: file.name } : null
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  const outMime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, outMime, outMime === 'image/jpeg' ? JPEG_QUALITY : undefined),
  )
  if (!blob) {
    const base64 = await readAsBase64(file)
    return base64 ? { mimeType: file.type, base64, name: file.name } : null
  }
  const base64 = await readAsBase64(blob)
  return base64 ? { mimeType: outMime, base64, name: file.name } : null
}
