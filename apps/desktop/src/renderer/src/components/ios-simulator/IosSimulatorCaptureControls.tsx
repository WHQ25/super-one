import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Square, Video } from 'lucide-react'
import type { IosSimulatorCapture } from '@superone/shared/ios-simulator'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { messageOf, notifyIosSimulatorCapture, reportIosSimulatorError } from './ios-simulator-report'

/**
 * `m:ss`, growing to `h:mm:ss` past the hour -- the clock every recorder shows,
 * rather than the "1m 23s" phrasing this codebase uses for finished durations. A
 * running counter is read for its digits, not its words.
 */
function formatRecordingClock(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${pad(seconds % 60)}`
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`
}

interface IosSimulatorCaptureControlsProps {
  sessionId: string
  /** Set while no device is streaming — the buttons stay in place, just unusable. */
  disabled?: boolean
}

/**
 * Screenshot and screen recording for the bound device. Both read the simulator's
 * own display through the main process rather than the preview canvas, so the file
 * is at native resolution and carries no device chrome.
 */
export function IosSimulatorCaptureControls({ sessionId, disabled }: IosSimulatorCaptureControlsProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // When simctl confirmed frames were flowing, so the clock counts the recording
  // rather than the button press. `null` whenever nothing is being recorded — which
  // makes it the recording flag too, rather than a second state to keep in step.
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const recording = startedAt !== null
  const [elapsed, setElapsed] = useState(0)
  // Mirrors `recording` for the unmount cleanup, which cannot read state that has
  // already been torn down.
  const recordingRef = useRef(false)

  // Derived from the start stamp on every tick, never accumulated, so a throttled
  // background window resumes on the right second instead of a count of fires.
  // Ticking faster than the digits change is what keeps them changing ON the second:
  // a 1s interval that starts mid-second shows every value ~1s late.
  useEffect(() => {
    if (startedAt === null) { setElapsed(0); return }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [startedAt])

  const announce = useCallback((capture: IosSimulatorCapture) => {
    notifyIosSimulatorCapture(
      t('activity.iosSimulator.captureSaved', { name: capture.fileName }),
      t('activity.iosSimulator.showInFinder'),
      capture.path,
    )
  }, [t])

  const screenshot = useCallback(async () => {
    setBusy(true)
    try {
      announce(await window.environment.iosSimulatorScreenshot(sessionId))
    } catch (cause) {
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [announce, sessionId])

  const toggleRecording = useCallback(async () => {
    setBusy(true)
    try {
      if (recordingRef.current) {
        const capture = await window.environment.iosSimulatorRecordStop(sessionId)
        recordingRef.current = false
        setStartedAt(null)
        if (capture) announce(capture)
        return
      }
      // Resolves only once simctl confirms frames are flowing, so the button never
      // claims to be recording a stream that failed to start.
      await window.environment.iosSimulatorRecordStart(sessionId)
      recordingRef.current = true
      setStartedAt(Date.now())
    } catch (cause) {
      recordingRef.current = false
      setStartedAt(null)
      reportIosSimulatorError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [announce, sessionId])

  // Leaving the stage takes the stop button with it. Ending the recording here
  // keeps it from running on unattended until the session detaches.
  useEffect(() => () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    void window.environment.iosSimulatorRecordStop(sessionId)
  }, [sessionId])

  return (
    <>
      <IconButton
        tooltip={t('activity.iosSimulator.screenshot')}
        onClick={() => { void screenshot() }}
        disabled={busy || disabled}
      >
        <Camera />
      </IconButton>
      <IconButton
        tooltip={t(`activity.iosSimulator.${recording ? 'recordStop' : 'recordStart'}`)}
        aria-pressed={recording}
        variant={recording ? 'destructive' : 'default'}
        onClick={() => { void toggleRecording() }}
        disabled={busy || disabled}
      >
        {recording ? <Square className="fill-current" /> : <Video />}
      </IconButton>
      {recording && (
        // `role="timer"` rather than a live region: assistive tech should be able to
        // read the length on demand without announcing a new number every second.
        <span
          role="timer"
          aria-label={t('activity.iosSimulator.recording')}
          className="px-1 text-xs font-medium tabular-nums text-destructive"
        >
          {formatRecordingClock(elapsed)}
        </span>
      )}
    </>
  )
}
