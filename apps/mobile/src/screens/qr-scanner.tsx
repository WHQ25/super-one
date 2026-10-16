import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet } from 'react-native'
import { expireQrCandidates, observeQrCandidate, type QrCandidate, type ScannerSize } from './qr-scanner-state'
import { QrScannerView } from './qr-scanner-view'

/** A generic QR picker: detecting a code never submits it automatically. */
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
  const clear = useCallback(() => { epoch.current++; latest.current = []; setCandidates([]) }, [])
  useEffect(() => {
    mounted.current = true
    const subscription = AppState.addEventListener('change', (state) => {
      activeRef.current = state === 'active'
      setActive(state === 'active')
      clear()
    })
    const timer = setInterval(() => {
      const next = expireQrCandidates(latest.current, Date.now())
      if (next === latest.current) return
      latest.current = next
      setCandidates(next)
    }, 200)
    return () => { mounted.current = false; subscription.remove(); clearInterval(timer) }
  }, [clear])

  const select = (candidate: QrCandidate) => {
    if (settled.current || !mounted.current || !activeRef.current || error) return
    const current = expireQrCandidates(latest.current, Date.now()).find((item) => item.id === candidate.id
      && item.result.type === candidate.result.type && item.result.data === candidate.result.data)
    if (!current) return
    settled.current = true
    props.onSelect(current.result)
  }
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
        const next = observeQrCandidate(latest.current, result, size, Date.now())
        latest.current = next
        setCandidates(next)
      }}
      onMountError={() => {
        if (!mounted.current || epoch.current !== cameraEpoch) return
        clear(); setError(true)
      }}
    /> : null}
  />
}
