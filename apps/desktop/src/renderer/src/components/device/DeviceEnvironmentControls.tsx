import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Settings2 } from 'lucide-react'
import type { DeviceProvider } from '@superone/shared/device'
import type {
  DeviceAppearance,
  DeviceEnvironmentAction,
  DeviceEnvironmentResult,
  DeviceEnvironmentState,
} from '@superone/shared/device-environment'
import { IOS_CONTENT_SIZES } from '@superone/shared/device-environment'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { CommitSlider } from './CommitSlider'

type ReadEnvironment = (deviceId: string) => Promise<DeviceEnvironmentState>
type ConfigureEnvironment = (deviceId: string, action: DeviceEnvironmentAction) => Promise<DeviceEnvironmentResult>

interface Props {
  deviceId: string
  provider: DeviceProvider
  disabled: boolean
  /**
   * The 3D body's finish, where it offers more than one. A look on this machine, not a
   * device setting, so it applies at once and is never read back from the device.
   */
  bodyColor?: { options: string[]; value: string; onChange: (color: string) => void }
  /** Injectable so stories can exercise the real controls without a device. */
  read?: ReadEnvironment
  configure?: ConfigureEnvironment
  subscribe?: (deviceId: string, callback: () => void) => () => void
}

function supported(provider: DeviceProvider, deviceId: string): boolean {
  return provider === 'ios-sim'
    || (provider === 'android' && (
      deviceId.startsWith('android:avd:') || /^android:emulator-\d+$/.test(deviceId)
    ))
}

/** Apple's variant names, e.g. `Night_Sky`, as words. */
const finishLabel = (name: string) => name.replace(/_/g, ' ')

export function DeviceEnvironmentControls({ deviceId, provider, disabled, bodyColor, read, configure, subscribe }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<DeviceEnvironmentState | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [draftTextSizeIndex, setDraftTextSizeIndex] = useState<number | null>(null)
  const generation = useRef(0)
  const applyingRef = useRef(false)
  const readDevice = read ?? ((id: string) => window.environment.deviceEnvironment(id))
  const configureDevice = configure ?? ((id: string, action: DeviceEnvironmentAction) =>
    window.environment.deviceConfigure(id, action))
  const subscribeDevice = subscribe ?? ((id: string, callback: () => void) =>
    window.environment.onDeviceEnvironmentChanged(id, callback))

  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const next = await readDevice(deviceId)
      if (request === generation.current) setState(next)
    } catch (cause) {
      if (request === generation.current) {
        setState(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [deviceId, read])

  // A reading belongs to its device, not to one opening of the popover: it is kept
  // while closed and read ahead, so opening shows it at once and re-reads underneath.
  useEffect(() => {
    generation.current += 1
    setState(null)
    setApplied(false)
  }, [deviceId])

  const readable = !disabled && supported(provider, deviceId)
  useEffect(() => {
    if (!readable) return
    void refresh()
    const unsubscribe = subscribeDevice(deviceId, () => {
      if (applyingRef.current) return
      setApplied(false)
      void refresh()
    })
    return () => { generation.current += 1; unsubscribe() }
  }, [deviceId, readable, subscribe, refresh])

  useEffect(() => {
    if (!open || !readable) return
    setApplied(false)
    void refresh()
    // Only on opening; the effect above covers the device and its availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const apply = async (action: DeviceEnvironmentAction) => {
    const request = ++generation.current
    applyingRef.current = true
    setApplying(true)
    setError(null)
    setApplied(false)
    try {
      const result = await configureDevice(deviceId, action)
      if (request === generation.current) {
        setState(result.state)
        setApplied(true)
      }
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      applyingRef.current = false
      setApplying(false)
      setDraftTextSizeIndex(null)
    }
  }

  useEffect(() => { setDraftTextSizeIndex(null) }, [deviceId, state?.textSize])

  if (!supported(provider, deviceId)) return null

  const prefix = 'activity.device.environment'
  const locationValid = latitude.trim() !== '' && longitude.trim() !== ''
    && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180
  const iosTextSizeLabels = [
    'textSizeExtraSmall', 'textSizeSmall', 'textSizeMedium', 'textSizeDefault',
    'textSizeLarge', 'textSizeExtraLarge', 'textSizeExtraExtraLarge',
    'textSizeAccessibilityMedium', 'textSizeAccessibilityLarge',
    'textSizeAccessibilityExtraLarge', 'textSizeAccessibilityExtraExtraLarge',
    'textSizeAccessibilityExtraExtraExtraLarge',
  ] as const
  const textSizeLabel = (value: string): string => {
    if (provider === 'android') return `${Math.round(Number(value) * 100)}%`
    const index = IOS_CONTENT_SIZES.indexOf(value as typeof IOS_CONTENT_SIZES[number])
    return index < 0 ? value : t(`${prefix}.${iosTextSizeLabels[index]}`)
  }
  const textSizeOptions = state?.textSizeOptions ?? []
  const currentTextSizeIndex = textSizeOptions.indexOf(state?.textSize ?? '')
  const sliderIndex = draftTextSizeIndex ?? Math.max(0, currentTextSizeIndex)
  const sliderValue = textSizeOptions[sliderIndex]
  const commitTextSize = (index: number) => {
    const value = textSizeOptions[index]
    if (!value || value === state?.textSize || applyingRef.current) return
    void apply({ kind: 'text_size', value })
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <IconButton tooltip={t(`${prefix}.title`)} disabled={disabled}>
        <Settings2 />
      </IconButton>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="max-h-[min(80vh,36rem)] w-72 space-y-3 overflow-y-auto bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{t(`${prefix}.title`)}</strong>
        <IconButton tooltip={t(`${prefix}.refresh`)} disabled={loading || applying} onClick={() => void refresh()}>
          <RefreshCw />
        </IconButton>
      </div>
      {bodyColor && <section className="space-y-1.5">
        <div className="text-xs font-medium">{t(`${prefix}.bodyColor`)}</div>
        <Tabs value={bodyColor.value} onValueChange={bodyColor.onChange}>
          <TabsList aria-label={t(`${prefix}.bodyColor`)} className="w-full">
            {bodyColor.options.map((value) => <TabsTrigger key={value} value={value} className="py-1">
              {finishLabel(value)}
            </TabsTrigger>)}
          </TabsList>
        </Tabs>
      </section>}
      {loading && !state && <p className="text-xs text-muted-foreground">{t('activity.device.checking')}</p>}
      {state && <>
        <section className="space-y-1.5">
          <div className="text-xs font-medium">{t(`${prefix}.appearance`)}</div>
          <Tabs value={state.appearance ?? ''} onValueChange={(value) =>
            void apply({ kind: 'appearance', value: value as DeviceAppearance })}>
            <TabsList aria-label={t(`${prefix}.appearance`)} className="w-full">
              {(['light', 'dark'] as const).map((value) => <TabsTrigger
                key={value} value={value} disabled={applying} className="py-1"
              >{t(`${prefix}.${value}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {state.appearance === null && <p className="text-xs text-muted-foreground">{t(`${prefix}.unknown`)}</p>}
        </section>
        {state.textSizeSupported && <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="font-medium">{t(`${prefix}.textSize`)}</div>
            <span className="text-muted-foreground">
              {sliderValue && (draftTextSizeIndex !== null || currentTextSizeIndex >= 0)
                ? textSizeLabel(sliderValue) : t(`${prefix}.unknown`)}
            </span>
          </div>
          <CommitSlider max={Math.max(0, textSizeOptions.length - 1)} value={sliderIndex}
            disabled={applying || currentTextSizeIndex < 0} label={t(`${prefix}.textSize`)}
            valueText={sliderValue ? textSizeLabel(sliderValue) : undefined}
            onDraft={setDraftTextSizeIndex} onCommit={commitTextSize} />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{textSizeOptions[0] ? textSizeLabel(textSizeOptions[0]) : ''}</span>
            <span>{textSizeOptions.at(-1) ? textSizeLabel(textSizeOptions.at(-1)!) : ''}</span>
          </div>
        </section>}
        <section className="space-y-1.5">
          <div className="text-xs font-medium">{t(`${prefix}.location`)}</div>
          <div className="grid gap-2">
            <input type="text" inputMode="decimal" aria-label={t(`${prefix}.latitude`)}
              placeholder={t(`${prefix}.latitude`)} value={latitude} onChange={(event) => setLatitude(event.target.value)}
              className="w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm" />
            <input type="text" inputMode="decimal" aria-label={t(`${prefix}.longitude`)}
              placeholder={t(`${prefix}.longitude`)} value={longitude} onChange={(event) => setLongitude(event.target.value)}
              className="w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm" />
          </div>
          <div className="flex gap-1">
            <Button type="button" size="sm" disabled={applying || !locationValid}
              onClick={() => void apply({ kind: 'location', latitude: Number(latitude), longitude: Number(longitude) })}>
              {t(`${prefix}.setLocation`)}
            </Button>
            {state.canClearLocation && <Button type="button" size="sm" variant="outline" disabled={applying}
              onClick={() => void apply({ kind: 'clear_location' })}>{t(`${prefix}.clearLocation`)}</Button>}
          </div>
          <p className="text-xs text-muted-foreground">{t(`${prefix}.locationUnreadable`)}</p>
        </section>
        {/* A foldable that takes any angle has the hinge control in the toolbar instead. */}
        {state.hingeDegrees === null && state.postures.length > 0 && <section className="space-y-1.5">
          <div className="text-xs font-medium">{t(`${prefix}.posture`)}</div>
          <div className="flex flex-wrap gap-1">
            {state.postures.map((posture) => <Button key={posture.id} type="button" size="sm"
              variant={posture.id === state.posture ? 'default' : 'outline'}
              aria-pressed={state.posture === null ? undefined : posture.id === state.posture}
              disabled={applying} onClick={() => void apply({ kind: 'posture', id: posture.id })}>
              {posture.label}
            </Button>)}
          </div>
          {state.posture === null
            && <p className="text-xs text-muted-foreground">{t(`${prefix}.postureUnreadable`)}</p>}
        </section>}
      </>}
      {applied && <p role="status" className="text-xs text-muted-foreground">{t(`${prefix}.applied`)}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>
}
