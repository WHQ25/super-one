import type { BarcodeScanningResult } from 'expo-camera'

// Expo can throttle identical results for 500 ms. Keep stationary targets alive
// across that interval, then expire detections which have not been refreshed.
export const QR_CANDIDATE_TTL_MS = 1000
// A lone detection is only trusted after no neighbour has appeared for this
// long. Small or distant codes in the same frame were measured on Android to go
// up to ~730 ms between detections, so the window must exceed that gap.
export const QR_AUTO_SELECT_MS = 1000
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

/** Native coordinates are already in the camera view's logical points. */
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

/** Collect every QR without interpreting its payload or starting a business flow. */
export function observeQrCandidate(
  candidates: QrCandidate[], result: BarcodeScanningResult, size: ScannerSize, now: number,
): QrCandidate[] {
  const fresh = expireQrCandidates(candidates, now)
  if (!result.data) return fresh
  const rect = visibleRect(result, size)
  if (!rect) return fresh
  // Match by both content and location so identical printed codes can each be
  // tapped, while small camera movements keep the same target number.
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

/** Expand small targets without placing the touch surface outside the preview. */
export function qrTargetRect(rect: ScannerRect, size: ScannerSize): ScannerRect {
  const width = Math.min(size.width, Math.max(44, rect.width))
  const height = Math.min(size.height, Math.max(44, rect.height))
  const x = Math.max(0, Math.min(size.width - width, rect.x + (rect.width - width) / 2))
  const y = Math.max(0, Math.min(size.height - height, rect.y + (rect.height - height) / 2))
  return { x, y, width, height }
}
