import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Lock, Stamp, Volume2, type LucideIcon } from 'lucide-react'
import type { MediaComposerModel } from '@superone/shared/media-composer'
import { Input } from '@superone/ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { EffortSlider, SELECTOR_TRIGGER_CLASS } from '../model-selector/GroupedModelEffortSelector'
import { MediaModelSelector, MediaOptionSelector, RatioIcon } from './MediaOptionSelector'
import type { ToolbarControl } from './OverflowControls'
import { GENERIC_IMAGE, GENERIC_VIDEO, resolutionOrientation, resolutionShape, resolutionTier, type VideoSettings } from './media-capabilities'

const AUTO = 'auto'

interface ModelProps {
  models: MediaComposerModel[]
  selected?: MediaComposerModel
  onSelectModel: (model: MediaComposerModel) => void
  onRefreshModels?: () => void
  modelsLoading?: boolean
}

function useModelControl({ models, selected, onSelectModel, onRefreshModels, modelsLoading }: ModelProps): ToolbarControl {
  const { t } = useTranslation()
  return { id: 'model', label: t('mediaComposer.model'),
    control: <MediaModelSelector models={models} selected={selected} onSelect={onSelectModel} onRefresh={onRefreshModels} loading={modelsLoading} /> }
}

function ratioControl(t: TFunction, ratios: string[], value: string, allowAuto: boolean, onChange: (ratio: string) => void): ToolbarControl {
  return { id: 'ratio', label: t('mediaComposer.aspectRatio'), control: (
    <MediaOptionSelector
      title={t('mediaComposer.aspectRatio')}
      label={value || t('mediaComposer.autoRatio')}
      leading={<RatioIcon ratio={value} size={12} />}
      value={value || AUTO}
      onChange={ratio => onChange(ratio === AUTO ? '' : ratio)}
      groups={[{ label: t('mediaComposer.aspectRatio'), options: [...(allowAuto ? [AUTO] : []), ...ratios].map(ratio => ({
        value: ratio, label: ratio === AUTO ? t('mediaComposer.automatic') : ratio,
        leading: <span className="text-muted-foreground"><RatioIcon ratio={ratio} size={16} /></span>,
      })) }]}
    />
  ) }
}

/** An on/off option shown as a pressed chip in the toolbar and a switch in the settings panel. */
function toggleControl(id: string, label: string, Icon: LucideIcon, checked: boolean, onChange: (checked: boolean) => void, chipLabel = label): ToolbarControl {
  return {
    id, label,
    control: (
      <button type="button" aria-pressed={checked} aria-label={label} title={label} onClick={() => onChange(!checked)}
        className={cn(SELECTOR_TRIGGER_CLASS, 'shrink-0', checked && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}>
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{chipLabel}</span>
      </button>
    ),
    panelControl: <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />,
  }
}

function SeedInput({ value, onChange, className }: { value?: number; onChange: (seed: number | undefined) => void; className?: string }) {
  const { t } = useTranslation()
  return <Input type="number" min={0} step={1} inputMode="numeric" aria-label={t('mediaComposer.seed')} placeholder={t('mediaComposer.randomSeed')}
    value={value ?? ''} className={cn('h-7 w-28 text-xs', className)}
    onChange={event => { const seed = Number.parseInt(event.target.value, 10); onChange(Number.isSafeInteger(seed) && seed >= 0 ? seed : undefined) }} />
}

function seedControl(t: TFunction, value: number | undefined, onChange: (seed: number | undefined) => void): ToolbarControl {
  const label = t('mediaComposer.seed')
  return {
    id: 'seed', label,
    control: (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" title={label} aria-label={`${label}: ${value ?? t('mediaComposer.randomSeed')}`} className={cn(SELECTOR_TRIGGER_CLASS, 'shrink-0')}>
            <span className="truncate">{value === undefined ? t('mediaComposer.randomSeedShort') : t('mediaComposer.seedValue', { seed: value })}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="flex w-auto items-center gap-2 p-2">
          <SeedInput value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
    ),
    panelControl: <SeedInput value={value} onChange={onChange} />,
  }
}

export function useImageControls({ aspectRatio = '', size = '', onChange, ...model }: ModelProps & {
  aspectRatio?: string; size?: string; onChange: (patch: { aspectRatio?: string; size?: string }) => void
}): ToolbarControl[] {
  const { t } = useTranslation()
  const capabilities = model.selected?.image ?? GENERIC_IMAGE
  const modelControl = useModelControl(model)
  const sizeLabel = (value: string) => value.replace('x', '×')
  return [
    modelControl,
    ...(capabilities.aspectRatios.length ? [ratioControl(t, capabilities.aspectRatios, aspectRatio, true, ratio => onChange({ aspectRatio: ratio }))] : []),
    ...(capabilities.sizes.length ? [{ id: 'size', label: t('mediaComposer.size'), control: (
      <MediaOptionSelector
        title={t('mediaComposer.size')}
        label={size ? sizeLabel(size) : t('mediaComposer.autoSize')}
        leading={!capabilities.aspectRatios.length && size.includes('x') ? <RatioIcon ratio={size.replace('x', ':')} size={12} /> : undefined}
        value={size || AUTO}
        onChange={value => onChange({ size: value === AUTO ? '' : value })}
        groups={[{ label: t('mediaComposer.size'), options: [AUTO, ...capabilities.sizes].map(value => ({
          value, label: value === AUTO ? t('mediaComposer.automatic') : sizeLabel(value),
          description: value === AUTO ? t('mediaComposer.sizeAutoHint') : undefined,
          leading: value.includes('x') ? <span className="text-muted-foreground"><RatioIcon ratio={value.replace('x', ':')} size={16} /></span> : undefined,
        })) }]}
      />
    ) }] : []),
  ]
}

export function useVideoControls({ settings, allowAuto, onChange, ...model }: ModelProps & {
  settings: VideoSettings
  /** User-started requests may leave choices to the model; agent requests carry concrete values. */
  allowAuto: boolean
  onChange: (patch: VideoSettings) => void
}): ToolbarControl[] {
  const { t } = useTranslation()
  const capabilities = model.selected?.video ?? GENERIC_VIDEO
  const modelControl = useModelControl(model)
  const resolutions = capabilities.resolutions
  const resolutionLabel = (value: string) => {
    const tier = resolutionTier(value)
    const orientation = resolutionOrientation(value)
    // Sizes that share a tier differ by orientation (Sora's 1280x720 and 720x1280).
    return orientation && orientation !== 'square' && resolutions.filter(option => resolutionTier(option) === tier).length > 1
      ? `${tier} · ${t(`mediaComposer.${orientation}`)}` : tier
  }
  const durationOptions = [...(allowAuto ? [{ value: AUTO, label: t('mediaComposer.automatic') }] : []),
    ...capabilities.durations.map(value => ({ value: String(value), label: t('mediaComposer.seconds', { count: value }) }))]
  const framesByResolution = !capabilities.aspectRatios.length
  return [
    modelControl,
    ...(capabilities.aspectRatios.length ? [ratioControl(t, capabilities.aspectRatios, settings.aspectRatio ?? '', allowAuto, ratio => onChange({ aspectRatio: ratio }))] : []),
    ...(resolutions.length ? [{ id: 'resolution', label: t('mediaComposer.resolution'), control: (
      <MediaOptionSelector
        title={t('mediaComposer.resolution')}
        label={settings.resolution ? resolutionLabel(settings.resolution) : t('mediaComposer.automatic')}
        leading={framesByResolution && settings.resolution ? <RatioIcon ratio={resolutionShape(settings.resolution)} size={12} /> : undefined}
        value={settings.resolution || AUTO}
        onChange={value => onChange({ resolution: value === AUTO ? undefined : value })}
        groups={[{ label: t('mediaComposer.resolution'), options: [...(allowAuto ? [AUTO] : []), ...resolutions].map(value => ({
          value, label: value === AUTO ? t('mediaComposer.automatic') : resolutionLabel(value),
          description: value === AUTO ? undefined : value.replace('x', '×'),
          leading: framesByResolution && value !== AUTO ? <span className="text-muted-foreground"><RatioIcon ratio={resolutionShape(value)} size={16} /></span> : undefined,
        })) }]}
      />
    ) }] : []),
    ...(capabilities.durations.length ? [{ id: 'duration', label: t('mediaComposer.duration'), control: (
      <MediaOptionSelector title={t('mediaComposer.duration')} label={settings.duration ? t('mediaComposer.seconds', { count: settings.duration }) : t('mediaComposer.autoDuration')}>
        <EffortSlider
          label={t('mediaComposer.duration')}
          effortOptions={durationOptions}
          selectedEffort={settings.duration ? String(settings.duration) : AUTO}
          onSelectEffort={value => onChange({ duration: value === AUTO ? undefined : Number(value) })}
        />
      </MediaOptionSelector>
    ) }] : []),
    ...(capabilities.generateAudio ? [toggleControl('generateAudio', t('mediaComposer.generateAudio'), Volume2, !!settings.generateAudio, generateAudio => onChange({ generateAudio }), t('mediaComposer.audio'))] : []),
    ...(capabilities.seed ? [seedControl(t, settings.seed, seed => onChange({ seed }))] : []),
    ...(capabilities.cameraFixed ? [toggleControl('cameraFixed', t('mediaComposer.cameraFixed'), Lock, !!settings.cameraFixed, cameraFixed => onChange({ cameraFixed }))] : []),
    ...(capabilities.watermark ? [toggleControl('watermark', t('mediaComposer.watermark'), Stamp, !!settings.watermark, watermark => onChange({ watermark }))] : []),
  ]
}
