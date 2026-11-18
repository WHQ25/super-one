import type { BarcodeScanningResult } from 'expo-camera'

export const QR_AUTO_SELECT_MS = 1000
export const QR_CANDIDATE_TTL_MS = QR_AUTO_SELECT_MS * 2
const MAX_CANDIDATES = 24

export type ScannerSize = { width: number; height: number }
export type ScannerRect = ScannerSize & { x: number; y: number }
export type QrCandidate = {
  id: number
  result: BarcodeScanningResult
  rect: ScannerRect
  seenAt: number
}

export function sameQrCandidate(a: QrCandidate, b: QrCandidate): boolean {
  return a.id === b.id && a.result.type === b.result.type && a.result.data === b.result.data
}

export function expireQrCandidates(candidates: QrCandidate[], now: number): QrCandidate[] {
  const fresh = candidates.filter((candidate) => now - candidate.seenAt < QR_CANDIDATE_TTL_MS)
  return fresh.length === candidates.length ? candidates : fresh
}

function visibleRect(result: BarcodeScanningResult, size: ScannerSize): ScannerRect | null {
  if (size.width <= 0 || size.height <= 0) return null
  const points = result.cornerPoints
  const bounds = result.bounds
  let rect: ScannerRect
  if (points?.length >= 3) {
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    rect = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  } else if (bounds) {
    rect = { x: bounds.origin.x, y: bounds.origin.y, ...bounds.size }
  } else return null
  if (Object.values(rect).some((value) => !Number.isFinite(value))) return null
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(size.width, rect.x + rect.width)
  const bottom = Math.min(size.height, rect.y + rect.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

export function observeQrCandidate(
  candidates: QrCandidate[], result: BarcodeScanningResult, size: ScannerSize, now: number,
): QrCandidate[] {
  const fresh = expireQrCandidates(candidates, now)
  if (!result.data) return fresh
  const rect = visibleRect(result, size)
  if (!rect) return fresh
  const existing = fresh.find((candidate) => {
    if (candidate.result.type !== result.type || candidate.result.data !== result.data) return false
    const dx = Math.abs(candidate.rect.x + candidate.rect.width / 2 - rect.x - rect.width / 2)
    const dy = Math.abs(candidate.rect.y + candidate.rect.height / 2 - rect.y - rect.height / 2)
    return dx < Math.max(candidate.rect.width, rect.width) / 2 && dy < Math.max(candidate.rect.height, rect.height) / 2
  })
  const candidate = { id: existing?.id ?? Math.max(0, ...fresh.map((item) => item.id)) + 1, result, rect, seenAt: now }
  if (existing) return fresh.map((item) => item === existing ? candidate : item)
  return [...fresh.slice(-(MAX_CANDIDATES - 1)), candidate]
}

export function observeQrCandidates(
  candidates: QrCandidate[], results: BarcodeScanningResult[], size: ScannerSize, now: number,
): QrCandidate[] {
  let next = expireQrCandidates(candidates, now)
  for (const result of results) {
    next = observeQrCandidate(next, result, size, now)
  }
  return next
}

export function mapImageQrCandidates(
  image: { width: number; height: number; barcodes: BarcodeScanningResult[] },
  size: ScannerSize,
  now: number,
): QrCandidate[] {
  const valid = image.barcodes.filter((item) => Boolean(item.data))
  if (valid.length === 0 || size.width <= 0 || size.height <= 0) return []
  const scale = image.width > 0 && image.height > 0
    ? Math.min(size.width / image.width, size.height / image.height)
    : 1
  const offsetX = image.width > 0 ? (size.width - image.width * scale) / 2 : 0
  const offsetY = image.height > 0 ? (size.height - image.height * scale) / 2 : 0
  return valid.slice(0, MAX_CANDIDATES).map((barcode, index) => {
    const mapped: BarcodeScanningResult = {
      ...barcode,
      cornerPoints: barcode.cornerPoints?.map((point) => ({
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY,
      })) ?? [],
      bounds: barcode.bounds ? {
        origin: {
          x: barcode.bounds.origin.x * scale + offsetX,
          y: barcode.bounds.origin.y * scale + offsetY,
        },
        size: {
          width: barcode.bounds.size.width * scale,
          height: barcode.bounds.size.height * scale,
        },
      } : {
        origin: { x: 0, y: 0 },
        size: { width: 0, height: 0 },
      },
    }
    const fallbackSide = Math.min(88, Math.max(44, Math.min(size.width, size.height) * 0.2))
    const rect = visibleRect(mapped, size) ?? {
      x: Math.max(8, Math.min(size.width - fallbackSide - 8, 16 + (index % 3) * (fallbackSide + 12))),
      y: Math.max(8, Math.min(size.height - fallbackSide - 8, (size.height - fallbackSide) / 2)),
      width: fallbackSide,
      height: fallbackSide,
    }
    return { id: index + 1, result: barcode, rect, seenAt: now }
  })
}

export function qrTargetRect(rect: ScannerRect, size: ScannerSize): ScannerRect {
  const width = Math.min(size.width, Math.max(44, rect.width))
  const height = Math.min(size.height, Math.max(44, rect.height))
  const x = Math.max(0, Math.min(size.width - width, rect.x + (rect.width - width) / 2))
  const y = Math.max(0, Math.min(size.height - height, rect.y + (rect.height - height) / 2))
  return { x, y, width, height }
}
