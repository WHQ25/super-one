import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function describeErr(e: unknown): string {
  const err = e as DOMException
  const name = err?.name || 'Error'
  const hint =
    name === 'NotAllowedError'
      ? ' — permission denied (manifest permissions.media + host prompt)'
      : name === 'NotFoundError'
        ? ' — no matching device on this machine'
        : name === 'NotReadableError'
          ? ' — device busy / held by another app'
          : name === 'SecurityError'
            ? ' — blocked by the iframe sandbox'
            : ''
  return `${name}: ${err?.message || String(e)}${hint}`
}

function Demo() {
  const [status, setStatus] = useState('Idle — uses standard navigator.mediaDevices.')
  const [recording, setRecording] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [camBusy, setCamBusy] = useState(false)
  const camStartingRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (audioRef.current) audioRef.current.src = URL.createObjectURL(blob)
        setStatus(`Recorded ${Math.round(blob.size / 1024)} KB`)
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      setStatus('Recording…')
    } catch (e) {
      setStatus('Mic — ' + describeErr(e))
    }
  }
  const stopMic = () => {
    recRef.current?.stop()
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    setRecording(false)
  }
  const startCam = async () => {
    // Re-entry guard: a pending getUserMedia with a still-clickable button is
    // a race generator — a 2nd start reassigns srcObject and aborts the 1st
    // play() (AbortError), leaving the element paused → black.
    if (camStartingRef.current || camStreamRef.current) return
    camStartingRef.current = true
    setCamBusy(true)
    setStatus('Requesting camera…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      camStreamRef.current = stream
      const v = videoRef.current
      if (v) {
        // React renders `muted` as an attribute, not the DOM property the
        // autoplay policy reads — set the property before play().
        v.muted = true
        v.srcObject = stream
        try {
          await v.play()
        } catch (playErr) {
          // AbortError = a newer load superseded this play(); benign, retry once.
          if ((playErr as DOMException)?.name === 'AbortError') {
            await new Promise((r) => setTimeout(r, 50))
            await v.play().catch(() => {})
          } else {
            throw playErr
          }
        }
      }
      setCamOn(true)
      const label = stream.getVideoTracks()[0]?.label || 'camera'
      setStatus(`Camera live (${label}) — stop tracks when done.`)
    } catch (e) {
      camStreamRef.current?.getTracks().forEach((t) => t.stop())
      camStreamRef.current = null
      setCamOn(false)
      setStatus('Camera — ' + describeErr(e))
    } finally {
      camStartingRef.current = false
      setCamBusy(false)
    }
  }
  const stopCam = () => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOn(false)
    setStatus('Camera stopped.')
  }

  // A live MediaStreamTrack outlives the React tree — stop every track on
  // unmount and on pagehide so the host's recording indicator clears when
  // the panel/app closes.
  useEffect(() => {
    const stopAll = () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      camStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      camStreamRef.current = null
    }
    window.addEventListener('pagehide', stopAll)
    return () => {
      window.removeEventListener('pagehide', stopAll)
      stopAll()
    }
  }, [])

  return (
    <div>
      <Row>
        {!recording ? (
          <Btn onClick={startMic}>Start mic</Btn>
        ) : (
          <Btn variant="ghost" onClick={stopMic}>
            Stop mic
          </Btn>
        )}
        {camBusy ? (
          <Btn disabled>Requesting…</Btn>
        ) : !camOn ? (
          <Btn onClick={startCam}>Start camera</Btn>
        ) : (
          <Btn variant="ghost" onClick={stopCam}>
            Stop camera
          </Btn>
        )}
      </Row>
      <audio ref={audioRef} controls className="w-full mt-3" />
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full mt-2 rounded-md bg-black max-h-56"
      />
      <Out>
        <span className={recording || camOn ? 'live-dot' : ''}>{status}</span>
      </Out>
    </div>
  )
}

const react = `import { useEffect, useRef } from 'react'

function Recorder() {
  const recRef = useRef(null)
  const streamRef = useRef(null)

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    const chunks = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      // play or upload the blob…
    }
    rec.start()
    recRef.current = rec
  }

  const stop = () => {
    recRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop()) // clears host rec dot
  }

  // Stop tracks on unmount so the host indicator clears
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  return (
    <>
      <button onClick={start}>Record</button>
      <button onClick={stop}>Stop</button>
    </>
  )
}`

const vanilla = `// permissions.media must declare { kind: 'microphone' | 'camera' }
// No bridge wrapper — use the standard Web API:
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true, video: true,
})
const rec = new MediaRecorder(stream)
rec.start()
// later:
rec.stop()
stream.getTracks().forEach((t) => t.stop())  // clears the host's red dot

// Let the user pick a device:
const devices = await navigator.mediaDevices.enumerateDevices()
const mics = devices.filter((d) => d.kind === 'audioinput')`

export const mediaSection: SectionDef = {
  id: 'media',
  icon: Camera,
  title: 'Media (Mic & Camera)',
  api: 'navigator.mediaDevices',
  blurb:
    'Declare permissions.media, then use the standard navigator.mediaDevices API. Stop tracks when done — the host shows a recording indicator.',
  Demo,
  react,
  vanilla,
}
