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

export function base64ToFile(base64: string, mimeType: string, name: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mimeType })
}

/** The attachment the agent views; `downscaled` says it is no longer the file the user gave. */
export async function downscaleImage(file: File, maxSide = MAX_SIDE): Promise<{ attachment: ImageAttachment; downscaled: boolean } | null> {
  const asIs = async () => {
    const base64 = await readAsBase64(file)
    return base64 ? { attachment: { mimeType: file.type, base64, name: file.name }, downscaled: false } : null
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return asIs()
  }

  const longSide = Math.max(bitmap.width, bitmap.height)
  if (longSide <= maxSide) {
    bitmap.close()
    return asIs()
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
    return asIs()
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  const outMime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, outMime, outMime === 'image/jpeg' ? JPEG_QUALITY : undefined),
  )
  if (!blob) return asIs()
  const base64 = await readAsBase64(blob)
  return base64 ? { attachment: { mimeType: outMime, base64, name: file.name }, downscaled: true } : null
}
