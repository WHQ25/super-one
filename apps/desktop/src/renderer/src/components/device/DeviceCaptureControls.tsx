import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Square, Video } from 'lucide-react'
import type { DeviceCapture } from '@superone/shared/device'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { messageOf, notifyDeviceCapture, reportDeviceError } from './device-report'

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

interface DeviceCaptureControlsProps {
  deviceId: string
  /** Set while no device is streaming — the buttons stay in place, just unusable. */
  disabled?: boolean
  /** False for providers that expose a preview but no native recorder. */
  canRecord?: boolean
  /** Natural platform limit; reaching it finalizes and saves the recording. */
  maxDurationMs?: number
}

/**
 * Screenshot and screen recording for the bound device. Both read the device's own
 * display through the main process rather than the preview canvas, so the file
 * is at native resolution and carries no device chrome.
 */
export function DeviceCaptureControls({
  deviceId,
  disabled,
  canRecord = true,
  maxDurationMs,
}: DeviceCaptureControlsProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // When the provider confirmed frames were flowing, so the clock counts the recording
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

  const announce = useCallback((capture: DeviceCapture) => {
    notifyDeviceCapture(
      t('activity.device.captureSaved', { name: capture.fileName }),
      t('activity.device.showInFinder'),
      capture.path,
    )
  }, [t])

  const screenshot = useCallback(async () => {
    setBusy(true)
    try {
      announce(await window.environment.deviceScreenshot(deviceId))
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [announce, deviceId])

  const finishRecording = useCallback(async () => {
    if (!recordingRef.current) return
    // Claim the stop before awaiting so the duration timer, button, and unmount
    // cleanup cannot race two finalization/pull operations for one device file.
    recordingRef.current = false
    setBusy(true)
    try {
      const capture = await window.environment.deviceRecordStop(deviceId)
      setStartedAt(null)
      if (capture) announce(capture)
    } catch (cause) {
      setStartedAt(null)
      reportDeviceError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [announce, deviceId])

  const toggleRecording = useCallback(async () => {
    if (recordingRef.current) {
      await finishRecording()
      return
    }
    setBusy(true)
    try {
      // Resolves only once the provider confirms recording, so the button never
      // claims to be recording a stream that failed to start.
      await window.environment.deviceRecordStart(deviceId)
      recordingRef.current = true
      setStartedAt(Date.now())
    } catch (cause) {
      recordingRef.current = false
      setStartedAt(null)
      reportDeviceError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [deviceId, finishRecording])

  useEffect(() => {
    if (startedAt === null || maxDurationMs === undefined) return
    const remaining = Math.max(0, startedAt + maxDurationMs - Date.now())
    const timer = setTimeout(() => { void finishRecording() }, remaining)
    return () => clearTimeout(timer)
  }, [finishRecording, maxDurationMs, startedAt])

  // Leaving the stage takes the stop button with it. Ending the recording here
  // keeps it from running on unattended until the session detaches.
  useEffect(() => () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    void window.environment.deviceRecordStop(deviceId)
  }, [deviceId])

  return (
    <>
      <IconButton
        tooltip={t('activity.device.screenshot')}
        onClick={() => { void screenshot() }}
        disabled={busy || disabled}
      >
        <Camera />
      </IconButton>
      <IconButton
        tooltip={t(`activity.device.${recording ? 'recordStop' : 'recordStart'}`)}
        aria-pressed={recording}
        variant={recording ? 'destructive' : 'default'}
        onClick={() => { void toggleRecording() }}
        disabled={busy || disabled || !canRecord}
      >
        {recording ? <Square className="fill-current" /> : <Video />}
      </IconButton>
      {recording && (
        // `role="timer"` rather than a live region: assistive tech should be able to
        // read the length on demand without announcing a new number every second.
        <span
          role="timer"
          aria-label={t('activity.device.recording')}
          className="px-1 text-xs font-medium tabular-nums text-destructive"
        >
          {formatRecordingClock(elapsed)}
        </span>
      )}
    </>
  )
}
