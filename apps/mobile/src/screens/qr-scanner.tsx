import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet } from 'react-native'
import {
  expireQrCandidates, observeQrCandidate, QR_AUTO_SELECT_MS, sameQrCandidate, type QrCandidate, type ScannerSize,
} from './qr-scanner-state'
import { QrScannerView } from './qr-scanner-view'

/**
 * A generic QR picker: a lone code submits once no neighbour appears within
 * the settle window; several codes wait for the user to tap one.
 */
export function QrScanner(props: {
  onSelect: (result: BarcodeScanningResult) => void
  onCancel: () => void
}) {
  const [candidates, setCandidates] = useState<QrCandidate[]>([])
  const [size, setSize] = useState<ScannerSize>({ width: 0, height: 0 })
  const [error, setError] = useState(false)
  const [cameraKey, setCameraKey] = useState(0)
  const [active, setActive] = useState(AppState.currentState == null || AppState.currentState === 'active')
  const settled = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  const epoch = useRef(0)
  const cameraEpoch = epoch.current
  const latest = useRef<QrCandidate[]>([])
  const lone = useRef<{ candidate: QrCandidate; timer: ReturnType<typeof setTimeout> } | null>(null)
  const selectRef = useRef<(candidate: QrCandidate) => void>(() => {})
  const update = useCallback((next: QrCandidate[]) => {
    latest.current = next
    setCandidates(next)
    // Restart the window whenever the scene changes, e.g. two codes become one.
    const only = next.length === 1 ? next[0]! : null
    if (only && lone.current && sameQrCandidate(lone.current.candidate, only)) return
    if (lone.current) clearTimeout(lone.current.timer)
    lone.current = only ? {
      candidate: only,
      timer: setTimeout(() => { lone.current = null; selectRef.current(only) }, QR_AUTO_SELECT_MS),
    } : null
  }, [])
  const clear = useCallback(() => { epoch.current++; update([]) }, [update])
  useEffect(() => {
    mounted.current = true
    const subscription = AppState.addEventListener('change', (state) => {
      activeRef.current = state === 'active'
      setActive(state === 'active')
      clear()
    })
    const timer = setInterval(() => {
      const next = expireQrCandidates(latest.current, Date.now())
      if (next !== latest.current) update(next)
    }, 200)
    return () => {
      mounted.current = false
      subscription.remove()
      clearInterval(timer)
      if (lone.current) clearTimeout(lone.current.timer)
    }
  }, [clear, update])

  const select = (candidate: QrCandidate) => {
    if (settled.current || !mounted.current || !activeRef.current || error) return
    const current = expireQrCandidates(latest.current, Date.now()).find((item) => sameQrCandidate(item, candidate))
    if (!current) return
    settled.current = true
    props.onSelect(current.result)
  }
  selectRef.current = select
  return <QrScannerView
    size={size}
    candidates={candidates}
    error={error}
    onSelect={select}
    onLayout={({ nativeEvent: { layout } }) => {
      if (layout.width === size.width && layout.height === size.height) return
      clear()
      setSize({ width: layout.width, height: layout.height })
    }}
    onCancel={() => { settled.current = true; clear(); props.onCancel() }}
    onRetry={() => { clear(); setError(false); setCameraKey((key) => key + 1) }}
    preview={active && !error ? <CameraView
      key={cameraKey}
      style={StyleSheet.absoluteFill}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={(result) => {
        if (settled.current || !mounted.current || !activeRef.current || epoch.current !== cameraEpoch) return
        update(observeQrCandidate(latest.current, result, size, Date.now()))
      }}
      onMountError={() => {
        if (!mounted.current || epoch.current !== cameraEpoch) return
        clear(); setError(true)
      }}
    /> : null}
  />
}
