import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FoldHorizontal } from 'lucide-react'
import {
  IOS_SIMULATOR_TENT_MAX_DEGREES,
  iosSimulatorFoldForm,
  type IosSimulatorFoldForm,
  type IosSimulatorFoldPosition,
} from '@superone/shared/ios-simulator'
import type { DeviceEnvironmentAction, DeviceEnvironmentResult } from '@superone/shared/device-environment'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { CommitSlider } from './CommitSlider'
import { messageOf, reportDeviceError } from './device-report'

/** Each form's name and the angles it spans. */
const FORMS = {
  closed: { label: 'fold', min: 0, max: 0 },
  tent: { label: 'tent', min: 1, max: IOS_SIMULATOR_TENT_MAX_DEGREES },
  open: { label: 'unfold', min: IOS_SIMULATOR_TENT_MAX_DEGREES + 1, max: 180 },
} as const satisfies Record<IosSimulatorFoldForm, { label: string; min: number; max: number }>

interface Props {
  deviceId: string
  /** Where the host last moved the hinge. */
  fold: IosSimulatorFoldPosition
  disabled: boolean
  /** The angle being dragged to, so the 3D body can follow ahead of the device; null when settled. */
  onPreview: (degrees: number | null) => void
  /** Injectable so stories can fold without a device. */
  configure?: (deviceId: string, action: DeviceEnvironmentAction) => Promise<DeviceEnvironmentResult>
}

/**
 * A foldable's hinge, 0 to 180°. The angle alone picks the form: closed at 0, a tent
 * up to `IOS_SIMULATOR_TENT_MAX_DEGREES`, open on the inner screen past it.
 */
export function DeviceHingeControl({ deviceId, fold, disabled, onPreview, configure }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  // Release, key-up and blur each commit; only the first of them moves the guest.
  const movingRef = useRef(false)
  const configureDevice = configure ?? ((id: string, action: DeviceEnvironmentAction) =>
    window.environment.deviceConfigure(id, action))

  // A settled angle, from here or from the agent, replaces whatever was dragged.
  useEffect(() => {
    setDraft(null)
    onPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, fold.hingeDegrees])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview(null), [])

  const value = draft ?? fold.hingeDegrees
  const form = FORMS[iosSimulatorFoldForm(value)]
  const settled = FORMS[iosSimulatorFoldForm(fold.hingeDegrees)]
  const marks = [
    { value: 0, label: `${t('activity.device.fold')} 0°` },
    { value: IOS_SIMULATOR_TENT_MAX_DEGREES, label: `${t('activity.device.tent')} ${IOS_SIMULATOR_TENT_MAX_DEGREES}°` },
    { value: 90, label: '90°' },
    { value: 180, label: `${t('activity.device.unfold')} 180°` },
  ]

  // The 3D body follows the drag; the guest moves once, on release. A guest move is a
  // spawned process and a panel the guest may swap, and the angles dragged past would
  // each reach SpringBoard and the app on screen as a fold of their own. The body
  // follows only within the settled form: past it, the lit panel and the way the
  // device is held change too, which only the guest's move shows.
  const drag = (degrees: number) => {
    setDraft(degrees)
    onPreview(Math.min(settled.max, Math.max(settled.min, degrees)))
  }
  const commit = async (degrees: number) => {
    if (movingRef.current) return
    if (degrees === fold.hingeDegrees) { setDraft(null); onPreview(null); return }
    movingRef.current = true
    setMoving(true)
    try {
      await configureDevice(deviceId, { kind: 'hinge', degrees })
    } catch (cause) {
      reportDeviceError(messageOf(cause))
    } finally {
      movingRef.current = false
      setMoving(false)
      setDraft(null)
      onPreview(null)
    }
  }

  return <Popover>
    <PopoverTrigger asChild>
      <IconButton tooltip={t('activity.device.hingeAngle')} disabled={disabled}>
        <FoldHorizontal />
      </IconButton>
    </PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-72 space-y-2 bg-card p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <strong className="font-medium">{t('activity.device.hingeAngle')}</strong>
        <span className="text-muted-foreground">{t(`activity.device.${form.label}`)} · {value}°</span>
      </div>
      <CommitSlider max={180} value={value} disabled={moving} marks={marks}
        label={t('activity.device.hingeAngle')} valueText={`${value}°`}
        onDraft={drag} onCommit={(degrees) => { void commit(degrees) }} />
    </PopoverContent>
  </Popover>
}
