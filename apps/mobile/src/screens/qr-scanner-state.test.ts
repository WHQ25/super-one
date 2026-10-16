import { describe, expect, it } from 'vitest'
import type { BarcodeScanningResult } from 'expo-camera'
import { expireQrCandidates, observeQrCandidate, QR_CANDIDATE_TTL_MS, qrTargetRect } from './qr-scanner-state'

const size = { width: 360, height: 640 }
const qr = (data: string, x = 20, y = 50): BarcodeScanningResult => ({
  type: 'qr', data, cornerPoints: [], bounds: { origin: { x, y }, size: { width: 100, height: 100 } },
})

describe('QR candidates', () => {
  it('retains every visible QR regardless of its payload and updates moving targets', () => {
    let candidates = observeQrCandidate([], qr('https://example.com/app.apk'), size, 0)
    candidates = observeQrCandidate(candidates, qr('superone://pair?channel=chosen', 180), size, 10)
    candidates = observeQrCandidate(candidates, qr('https://example.com/app.apk', 25), size, 600)
    expect(candidates.map(({ id, result }) => [id, result.data])).toEqual([
      [1, 'https://example.com/app.apk'], [2, 'superone://pair?channel=chosen'],
    ])
    expect(candidates[0]!.rect.x).toBe(25)
  })

  it('keeps identical codes at distinct positions separately selectable', () => {
    let candidates = observeQrCandidate([], qr('same', 20), size, 0)
    candidates = observeQrCandidate(candidates, qr('same', 180), size, 10)
    expect(candidates.map(({ id }) => id)).toEqual([1, 2])
  })

  it('expires lost detections and preserves recent stationary ones across Expo throttling', () => {
    let candidates = observeQrCandidate([], qr('lost'), size, 0)
    candidates = observeQrCandidate(candidates, qr('present', 180), size, 600)
    expect(expireQrCandidates(candidates, 600)).toHaveLength(2)
    expect(expireQrCandidates(candidates, QR_CANDIDATE_TTL_MS).map(({ result }) => result.data)).toEqual(['present'])
    expect(expireQrCandidates(candidates, 1600)).toEqual([])
  })

  it('uses corner extrema regardless of iOS and Android corner ordering', () => {
    const points = [{ x: 20, y: 150 }, { x: 120, y: 150 }, { x: 20, y: 50 }, { x: 120, y: 50 }]
    const result = { ...qr('corners'), cornerPoints: points }
    expect(observeQrCandidate([], result, size, 0)[0]!.rect).toEqual({ x: 20, y: 50, width: 100, height: 100 })
    expect(observeQrCandidate([], { ...result, cornerPoints: [...points].reverse() }, size, 0)[0]!.rect).toEqual({ x: 20, y: 50, width: 100, height: 100 })
  })

  it('clips partially visible targets and rejects absent, invalid or offscreen positions', () => {
    expect(observeQrCandidate([], qr('partial', -50), size, 0)[0]!.rect).toEqual({ x: 0, y: 50, width: 50, height: 100 })
    expect(observeQrCandidate([], qr('offscreen', 400), size, 0)).toEqual([])
    expect(observeQrCandidate([], qr('invalid', NaN), size, 0)).toEqual([])
    expect(observeQrCandidate([], { ...qr('empty'), bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } } }, size, 0)).toEqual([])
    expect(observeQrCandidate([], qr('before layout'), { width: 0, height: 0 }, 0)).toEqual([])
  })

  it('keeps small touch targets inside the preview', () => {
    expect(qrTargetRect({ x: 350, y: 630, width: 10, height: 10 }, size)).toEqual({ x: 316, y: 596, width: 44, height: 44 })
  })
})
