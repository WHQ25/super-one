import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, StyleSheet } from 'react-native'
import {
  NativeQrCamera,
  nativeAndroidQrCameraAvailable,
  pickAndScanQrImage,
  type PickedQrImage,
} from './native-qr-scanner'
import {
  expireQrCandidates,
  mapImageQrCandidates,
  observeQrCandidate,
  observeQrCandidates,
  QR_AUTO_SELECT_MS,
  sameQrCandidate,
  type QrCandidate,
  type ScannerSize,
} from './qr-scanner-state'
import { QrScannerView, type QrScannerNotice } from './qr-scanner-view'

export function QrScanner(props: {
  onSelect: (result: BarcodeScanningResult) => void
  onCancel: () => void
}) {
  const [candidates, setCandidates] = useState<QrCandidate[]>([])
  const [size, setSize] = useState<ScannerSize>({ width: 0, height: 0 })
  const [error, setError] = useState(false)
  const [torch, setTorch] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [photo, setPhoto] = useState<PickedQrImage | null>(null)
  const [notice, setNotice] = useState<QrScannerNotice>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [active, setActive] = useState(AppState.currentState == null || AppState.currentState === 'active')
  const settled = useRef(false)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  const photoRef = useRef<PickedQrImage | null>(null)
  const epoch = useRef(0)
  const cameraEpoch = epoch.current
  const latest = useRef<QrCandidate[]>([])
  const lone = useRef<{ candidate: QrCandidate; timer: ReturnType<typeof setTimeout> } | null>(null)
  const selectRef = useRef<(candidate: QrCandidate) => void>(() => {})

  photoRef.current = photo

  const update = useCallback((next: QrCandidate[]) => {
    latest.current = next
    setCandidates(next)
    if (next.length > 0) setNotice(null)
    const only = next.length === 1 ? next[0]! : null
    if (only && lone.current && sameQrCandidate(lone.current.candidate, only)) return
    if (lone.current) clearTimeout(lone.current.timer)
    lone.current = only ? {
      candidate: only,
      timer: setTimeout(() => { lone.current = null; selectRef.current(only) }, QR_AUTO_SELECT_MS),
    } : null
  }, [])

  const clear = useCallback(() => {
    epoch.current++
    update([])
  }, [update])

  useEffect(() => {
    mounted.current = true
    const subscription = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active'
      activeRef.current = isActive
      setActive(isActive)
      if (!isActive) setTorch(false)
      clear()
    })
    const timer = setInterval(() => {
      if (photoRef.current) return
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

  const commit = (result: BarcodeScanningResult) => {
    if (settled.current || !mounted.current) return
    settled.current = true
    props.onSelect(result)
  }

  const select = (candidate: QrCandidate) => {
    if (settled.current || !mounted.current) return
    if (photoRef.current) {
      commit(candidate.result)
      return
    }
    if (!activeRef.current || error) return
    const current = expireQrCandidates(latest.current, Date.now()).find((item) => sameQrCandidate(item, candidate))
    if (!current) return
    commit(current.result)
  }
  selectRef.current = select

  const photoCandidates = useMemo(
    () => (photo ? mapImageQrCandidates(photo, size, Date.now()) : null),
    [photo, size],
  )

  const handlePickPhoto = async () => {
    try {
      const picked = await pickAndScanQrImage()
      if (!picked || !mounted.current || settled.current) return
      const valid = picked.barcodes.filter((item) => Boolean(item.data))
      if (valid.length === 0) {
        setPhoto(null)
        setNotice('empty-image')
        return
      }
      setNotice(null)
      clear()
      if (valid.length === 1) {
        commit(valid[0]!)
        return
      }
      setPhoto({ ...picked, barcodes: valid })
    } catch {
      if (!mounted.current || settled.current) return
      setPhoto(null)
      setNotice('invalid-image')
    }
  }

  const handleMountError = () => {
    if (!mounted.current || epoch.current !== cameraEpoch) return
    clear()
    setTorch(false)
    setError(true)
  }

  const cameraRunning = active && !error && !photo

  return (
    <QrScannerView
      size={size}
      candidates={photoCandidates ?? candidates}
      error={error}
      torch={torch}
      zoomed={zoomed}
      photoUri={photo?.uri ?? null}
      notice={notice}
      onSelect={select}
      onToggleTorch={() => setTorch((current) => !current)}
      onToggleZoom={() => setZoomed((current) => !current)}
      onPickPhoto={() => void handlePickPhoto()}
      onClearPhoto={() => {
        setPhoto(null)
        setNotice(null)
        clear()
      }}
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width === size.width && layout.height === size.height) return
        clear()
        setSize({ width: layout.width, height: layout.height })
      }}
      onCancel={() => {
        settled.current = true
        clear()
        props.onCancel()
      }}
      onRetry={() => {
        clear()
        setNotice(null)
        setError(false)
        setCameraKey((key) => key + 1)
      }}
      preview={cameraRunning ? (
        nativeAndroidQrCameraAvailable ? (
          <NativeQrCamera
            key={cameraKey}
            style={StyleSheet.absoluteFill}
            active={cameraRunning}
            enableTorch={torch}
            zoom={zoomed ? 2 : 1}
            onBarcodesScanned={(results) => {
              if (settled.current || !mounted.current || !activeRef.current || photoRef.current || epoch.current !== cameraEpoch) return
              update(observeQrCandidates(latest.current, results, size, Date.now()))
            }}
            onMountError={handleMountError}
          />
        ) : (
          <CameraView
            key={cameraKey}
            style={StyleSheet.absoluteFill}
            facing="back"
            autofocus="on"
            enableTorch={torch}
            zoom={zoomed ? 0.15 : 0}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => {
              if (settled.current || !mounted.current || !activeRef.current || photoRef.current || epoch.current !== cameraEpoch) return
              update(observeQrCandidate(latest.current, result, size, Date.now()))
            }}
            onMountError={handleMountError}
          />
        )
      ) : null}
    />
  )
}
