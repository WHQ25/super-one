import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FoldHorizontal } from 'lucide-react'
import {
  iosSimulatorFoldForm,
  iosSimulatorFoldPosture,
  type IosSimulatorFoldForm,
  type IosSimulatorFoldPosition,
} from '@superone/shared/ios-simulator'
import type { DeviceEnvironmentAction, DeviceEnvironmentResult } from '@superone/shared/device-environment'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { CommitSlider } from './CommitSlider'
import { messageOf, reportDeviceError } from './device-report'
import { HINGE_CLICK_DEGREES_PER_SECOND } from './device-hinge-motion'

const LABELS = { closed: 'fold', tent: 'tent', open: 'unfold', laptop: 'laptop' } as const satisfies
  Record<IosSimulatorFoldForm, string>

/** One angle per form, each the named posture's own: where a drag snaps and dwells. */
const STOPS = (['closed', 'tent', 'laptop', 'opened'] as const).map((posture) => ({
  degrees: iosSimulatorFoldPosture(posture).hingeDegrees,
  label: LABELS[iosSimulatorFoldForm(iosSimulatorFoldPosture(posture).hingeDegrees)],
}))
/** How near a stop a drag is pulled onto it; a degree is too fine to stop at by hand. */
const SNAP_DEGREES = 3
/** How long a drag rests on a stop before the device, and the 3D body, take that form. */
export const HINGE_DWELL_MS = 500

function snap(degrees: number): number {
  return STOPS.find((stop) => Math.abs(stop.degrees - degrees) <= SNAP_DEGREES)?.degrees ?? degrees
}

const isStop = (degrees: number) => STOPS.some((stop) => stop.degrees === degrees)

interface Props {
  deviceId: string
  /** Where the host last moved the hinge. */
  fold: IosSimulatorFoldPosition
  disabled: boolean
  /** The angle the hinge is held at, for the 3D body to follow ahead of the device; null when settled. */
  onPreview: (degrees: number | null) => void
  /**
   * The angle the device is being sent to, whose form the 3D body takes ahead of it;
   * null for the form the device is in. Only a send changes it, so a fast drag through
   * several forms bends the body without turning it into each one.
   */
  onFormPreview: (degrees: number | null) => void
  /** True while a drag is held, and while a click is still travelling. The 3D body only scrubs until this ends. */
  onScrubbing?: (scrubbing: boolean) => void
  /** Injectable so stories can fold without a device. */
  configure?: (deviceId: string, action: DeviceEnvironmentAction) => Promise<DeviceEnvironmentResult>
}

/**
 * A foldable's hinge, 0 to 180°. The angle alone picks the form; each form has a stop,
 * its named posture's angle, which a drag snaps to.
 *
 * While the angle is held — a drag, or a click still travelling — the 3D body scrubs
 * its clip and leaves the half without the cover where it stands. The camera keeps its
 * angle. The frame slides so the body stays centered, and the distance changes only to
 * fit that centered size. Letting go turns the view once, by the smallest angle, to
 * that form.
 *
 * A click on a mark or the track travels at `HINGE_CLICK_DEGREES_PER_SECOND` and lets go when
 * it arrives, in the form that angle belongs to. 55° finishes as a tent, as 45° then 55°
 * would. It does not take the stops it only passes. A wider click takes longer. Reduced
 * motion jumps and lets go at once.
 *
 * The guest moves only on that release, or when a drag rests on a stop for
 * `HINGE_DWELL_MS`: a guest move is a spawned process and may swap the lit panel, and
 * every angle dragged past would reach SpringBoard and the app on screen as a fold of
 * its own. A rest can send the guest while the body is still held; the body takes the
 * new form when the hold ends. A click does not rest on the stops it passes.
 *
 * A stop changes the form: rested on, or let go on. So does a click landing in a form,
 * and letting go on an opening that reads as a book, on either side of the laptop.
 * Leaving the body tipped as the form it came from parks it at a strange angle.
 * Letting go of a drag anywhere else moves the guest within the form it is in, and past
 * that form bends the 3D body alone, leaving the device where it was.
 */
export function DeviceHingeControl({ deviceId, fold, disabled, onPreview, onFormPreview, onScrubbing, configure }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number | null>(null)
  const dragging = useRef(false)
  const scrubbing = useRef(false)
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)
  // One guest move at a time; a newer target waits and replaces any older waiting one.
  const moving = useRef<number | null>(null)
  const queued = useRef<number | null>(null)
  const settledAt = useRef(fold.hingeDegrees)
  settledAt.current = fold.hingeDegrees
  // The angle on screen, including a click that has not been committed yet.
  const shown = useRef(fold.hingeDegrees)
  const sweepFrame = useRef<number | null>(null)
  const sweeping = useRef(false)
  const configureDevice = configure ?? ((id: string, action: DeviceEnvironmentAction) =>
    window.environment.deviceConfigure(id, action))

  const release = () => {
    setDraft(null)
    shown.current = settledAt.current
    onPreview(null)
    onFormPreview(null)
  }
  const previewAt = (degrees: number) => {
    shown.current = degrees
    setDraft(Math.round(degrees))
    onPreview(degrees)
  }
  const stopDwelling = () => {
    if (dwell.current) clearTimeout(dwell.current)
    dwell.current = null
  }
  const cancelSweep = () => {
    if (sweepFrame.current !== null) cancelAnimationFrame(sweepFrame.current)
    sweepFrame.current = null
    sweeping.current = false
  }

  const setScrubbing = (next: boolean) => {
    if (scrubbing.current === next) return
    scrubbing.current = next
    onScrubbing?.(next)
  }

  // A settled angle, from here or from the agent, replaces the draft once nothing holds it.
  useEffect(() => {
    if (!dragging.current && moving.current === null) release()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, fold.hingeDegrees])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopDwelling(); cancelSweep(); setScrubbing(false); onPreview(null); onFormPreview(null) }, [])

  const move = async (degrees: number): Promise<void> => {
    onFormPreview(degrees === settledAt.current ? null : degrees)
    if (moving.current !== null) { queued.current = degrees; return }
    if (degrees === settledAt.current) { if (!dragging.current) release(); return }
    moving.current = degrees
    try {
      await configureDevice(deviceId, { kind: 'hinge', degrees })
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    }
    moving.current = null
    const next = queued.current
    queued.current = null
    if (next !== null && next !== degrees) return move(next)
    if (!dragging.current) release()
  }

  const drag = (raw: number) => {
    // A finger takes over from a click that was still travelling.
    cancelSweep()
    const degrees = snap(raw)
    dragging.current = true
    setScrubbing(true)
    previewAt(degrees)
    stopDwelling()
    if (!isStop(degrees)) return
    dwell.current = setTimeout(() => {
      dwell.current = null
      void move(degrees)
    }, HINGE_DWELL_MS)
  }
  const commit = (raw: number, adopt = false) => {
    // Release, key-up and blur each commit; only the first after a drag counts.
    // A click commits itself when it arrives, so the pointer-up that started it does not.
    if (sweeping.current || !dragging.current) return
    dragging.current = false
    setScrubbing(false)
    stopDwelling()
    const degrees = snap(raw)
    const form = iosSimulatorFoldForm(degrees)
    // 61°–80° and 121°–180° are the book. Letting go there opens it, including straight
    // from fold; otherwise the body stays stood as whatever it left. A click adopts the
    // form it lands in. A drag let go off a stop, in another form, only bends.
    const book = form === 'open'
    if (isStop(degrees) || book || adopt || form === iosSimulatorFoldForm(settledAt.current)) void move(degrees)
  }
  /** The same hold as a drag, at a fixed rate, letting go when the angle arrives. */
  const seek = (raw: number) => {
    const to = snap(raw)
    const from = shown.current
    cancelSweep()
    stopDwelling()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced || Math.abs(to - from) < 0.5) {
      dragging.current = true
      setScrubbing(true)
      previewAt(to)
      commit(to, true)
      return
    }
    dragging.current = true
    setScrubbing(true)
    previewAt(from)
    const start = performance.now()
    const duration = (Math.abs(to - from) / HINGE_CLICK_DEGREES_PER_SECOND) * 1000
    sweeping.current = true
    const frame = (now: number) => {
      if (!sweeping.current) return
      const t = Math.min(1, (now - start) / duration)
      if (t < 1) {
        previewAt(from + (to - from) * t)
        if (!sweeping.current) return
        sweepFrame.current = requestAnimationFrame(frame)
        return
      }
      sweeping.current = false
      sweepFrame.current = null
      previewAt(to)
      commit(to, true)
    }
    sweepFrame.current = requestAnimationFrame(frame)
  }

  const value = draft ?? fold.hingeDegrees
  const form = LABELS[iosSimulatorFoldForm(value)]
  const marks = STOPS.map((stop) => ({ value: stop.degrees, label: `${t(`activity.device.${stop.label}`)} ${stop.degrees}°` }))

  return <Popover>
    <PopoverTrigger asChild>
      <IconButton tooltip={t('activity.device.hingeAngle')} disabled={disabled}>
        <FoldHorizontal />
      </IconButton>
    </PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-72 space-y-2 bg-card p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <strong className="font-medium">{t('activity.device.hingeAngle')}</strong>
        <span className="text-muted-foreground">{t(`activity.device.${form}`)} · {value}°</span>
      </div>
      <CommitSlider max={180} value={value} disabled={disabled} marks={marks}
        label={t('activity.device.hingeAngle')} valueText={`${value}°`}
        onDraft={drag} onCommit={commit} onSeek={seek} />
    </PopoverContent>
  </Popover>
}
