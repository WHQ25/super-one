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

type ReadEnvironment = (deviceId: string) => Promise<DeviceEnvironmentState>
type ConfigureEnvironment = (deviceId: string, action: DeviceEnvironmentAction) => Promise<DeviceEnvironmentResult>

interface Props {
  deviceId: string
  provider: DeviceProvider
  disabled: boolean
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

export function DeviceEnvironmentControls({ deviceId, provider, disabled, read, configure, subscribe }: Props) {
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

  useEffect(() => {
    generation.current += 1
    setState(null)
    setApplied(false)
    if (!open || disabled) return
    void refresh()
    const unsubscribe = subscribeDevice(deviceId, () => {
      if (applyingRef.current) return
      setApplied(false)
      void refresh()
    })
    return () => { generation.current += 1; unsubscribe() }
  }, [deviceId, disabled, open, subscribe, refresh])

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
          <div className="relative flex h-6 items-center">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary"
                style={{ width: `${textSizeOptions.length > 1 ? sliderIndex / (textSizeOptions.length - 1) * 100 : 0}%` }} />
            </div>
            <input type="range" min={0} max={Math.max(0, textSizeOptions.length - 1)}
              step={1} value={sliderIndex} disabled={applying || currentTextSizeIndex < 0}
              aria-label={t(`${prefix}.textSize`)}
              aria-valuetext={sliderValue ? textSizeLabel(sliderValue) : undefined}
              onChange={(event) => setDraftTextSizeIndex(Number(event.currentTarget.value))}
              onPointerUp={(event) => commitTextSize(Number(event.currentTarget.value))}
              onKeyUp={(event) => commitTextSize(Number(event.currentTarget.value))}
              onBlur={(event) => commitTextSize(Number(event.currentTarget.value))}
              className="relative h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card" />
          </div>
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
        {state.postures.length > 0 && <section className="space-y-1.5">
          <div className="text-xs font-medium">{t(`${prefix}.posture`)}</div>
          <div className="flex flex-wrap gap-1">
            {state.postures.map((posture) => <Button key={posture.id} type="button" size="sm" variant="outline"
              disabled={applying} onClick={() => void apply({ kind: 'posture', id: posture.id })}>
              {posture.label}
            </Button>)}
          </div>
          <p className="text-xs text-muted-foreground">{t(`${prefix}.postureUnreadable`)}</p>
        </section>}
      </>}
      {applied && <p role="status" className="text-xs text-muted-foreground">{t(`${prefix}.applied`)}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>
}
