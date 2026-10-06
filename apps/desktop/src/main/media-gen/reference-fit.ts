import { createRequire } from 'module'
import type { ReferenceImageLimits } from './capabilities'

const requireElectron = createRequire(import.meta.url)

const JPEG_QUALITY = 92
const MAX_ATTEMPTS = 8

export interface FitImage {
  mediaType: string
  data: Uint8Array
}

/** Minimal surface so unit tests can stub decoding without loading Electron. */
export interface FitNativeImage {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: (opts: { width: number; height: number; quality?: string }) => FitNativeImage
  toPNG: () => Buffer
  toJPEG: (quality: number) => Buffer
}

export type DecodeImage = (data: Uint8Array) => FitNativeImage

// Electron loads on first decode, so unit tests can exercise the fitting without it.
const decodeWithElectron: DecodeImage = data => {
  const { nativeImage } = requireElectron('electron') as typeof import('electron')
  return nativeImage.createFromBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength)) as unknown as FitNativeImage
}

/**
 * Shrinks reference images that exceed the model's input limits; images within them pass through
 * byte for byte. Users attach originals so generation keeps every detail the provider accepts.
 */
export function fitReferenceImages(images: FitImage[], limits: ReferenceImageLimits, decode: DecodeImage = decodeWithElectron): FitImage[] {
  const total = images.reduce((sum, image) => sum + image.data.byteLength, 0)
  const share = limits.maxTotalBytes && total > limits.maxTotalBytes ? Math.floor(limits.maxTotalBytes / images.length) : Infinity
  const budget = Math.min(limits.maxBytes, share)
  return images.map(image => fitImage(image, budget, limits, decode))
}

function fitImage(image: FitImage, budget: number, limits: ReferenceImageLimits, decode: DecodeImage): FitImage {
  if (image.data.byteLength <= budget && !limits.maxPixels && !limits.maxSide) return image
  const decoded = decode(image.data)
  // A format Electron cannot decode goes as-is; the provider reports whether it accepts it.
  if (decoded.isEmpty()) return image
  const { width, height } = decoded.getSize()
  let scale = Math.min(1,
    limits.maxPixels ? Math.sqrt(limits.maxPixels / (width * height)) : 1,
    limits.maxSide ? limits.maxSide / Math.max(width, height) : 1)
  if (scale === 1 && image.data.byteLength <= budget) return image
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resized = scale < 1
      ? decoded.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), quality: 'best' })
      : decoded
    // PNG keeps transparency; JPEG takes over when PNG cannot meet the budget.
    const png = image.mediaType === 'image/png' ? resized.toPNG() : undefined
    const fitted = png && png.byteLength <= budget ? { mediaType: 'image/png', data: png } : { mediaType: 'image/jpeg', data: resized.toJPEG(JPEG_QUALITY) }
    if (fitted.data.byteLength <= budget) return fitted
    scale *= Math.sqrt(budget / fitted.data.byteLength) * 0.95
  }
  throw new Error(`Reference image could not be reduced to the model's ${Math.round(budget / 1024 / 1024)} MB limit`)
}
