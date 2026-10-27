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
  /** Injectable so stories can fold without a device. */
  configure?: (deviceId: string, action: DeviceEnvironmentAction) => Promise<DeviceEnvironmentResult>
}

/**
 * A foldable's hinge, 0 to 180°. The angle alone picks the form; each form has a stop,
 * its named posture's angle, which a drag snaps to.
 *
 * The 3D body's hinge follows the drag the whole way. The guest moves only on release, or
 * when the drag rests on a stop for `HINGE_DWELL_MS`: a guest move is a spawned process
 * and may swap the lit panel, and every angle dragged past would reach SpringBoard and
 * the app on screen as a fold of its own. The body takes a new form at that same moment.
 *
 * Only a stop changes the form: rested on, let go on, or its label pressed. A drag let go
 * anywhere else moves the guest within the form it is in, and past that form bends the
 * 3D body alone, leaving the device where it was.
 */
export function DeviceHingeControl({ deviceId, fold, disabled, onPreview, onFormPreview, configure }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number | null>(null)
  const dragging = useRef(false)
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)
  // One guest move at a time; a newer target waits and replaces any older waiting one.
  const moving = useRef<number | null>(null)
  const queued = useRef<number | null>(null)
  const settledAt = useRef(fold.hingeDegrees)
  settledAt.current = fold.hingeDegrees
  const configureDevice = configure ?? ((id: string, action: DeviceEnvironmentAction) =>
    window.environment.deviceConfigure(id, action))

  const release = () => {
    setDraft(null)
    onPreview(null)
    onFormPreview(null)
  }
  const stopDwelling = () => {
    if (dwell.current) clearTimeout(dwell.current)
    dwell.current = null
  }

  // A settled angle, from here or from the agent, replaces the draft once nothing holds it.
  useEffect(() => {
    if (!dragging.current && moving.current === null) release()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, fold.hingeDegrees])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopDwelling(); onPreview(null); onFormPreview(null) }, [])

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
    const degrees = snap(raw)
    dragging.current = true
    setDraft(degrees)
    onPreview(degrees)
    stopDwelling()
    if (!isStop(degrees)) return
    dwell.current = setTimeout(() => {
      dwell.current = null
      void move(degrees)
    }, HINGE_DWELL_MS)
  }
  const commit = (raw: number) => {
    // Release, key-up and blur each commit; only the first after a drag counts.
    if (!dragging.current) return
    dragging.current = false
    stopDwelling()
    const degrees = snap(raw)
    if (isStop(degrees) || iosSimulatorFoldForm(degrees) === iosSimulatorFoldForm(settledAt.current)) void move(degrees)
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
        onDraft={drag} onCommit={commit} />
    </PopoverContent>
  </Popover>
}
