import type { MediaComposerReference, MediaImageCapabilities, MediaVideoCapabilities } from '@superone/shared/media-composer'

const COMMON_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']

/** Controls for a model whose endpoint reported no capabilities: the values most adapters read. */
export const GENERIC_IMAGE: MediaImageCapabilities = { aspectRatios: COMMON_RATIOS, sizes: [] }
export const GENERIC_VIDEO: MediaVideoCapabilities = {
  aspectRatios: COMMON_RATIOS, resolutions: ['854x480', '1280x720', '1920x1080'], durations: [4, 5, 6, 8, 10, 12],
  seed: false, generateAudio: false, watermark: false, cameraFixed: false, firstFrame: true, lastFrame: true, references: true,
}

const TIERS: Record<number, string> = { 480: '480p', 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' }
const pixels = (value: string) => /^(\d+)x(\d+)$/.exec(value)?.slice(1).map(Number) as [number, number] | undefined

/** `1280x720` → `720p`; tier names (`720p`) pass through; other sizes read as `1792×1024`. */
export function resolutionTier(value: string): string {
  const size = pixels(value)
  if (!size) return value
  return TIERS[Math.min(...size)] ?? `${size[0]}×${size[1]}`
}

export function resolutionOrientation(value: string): 'landscape' | 'portrait' | 'square' | undefined {
  const size = pixels(value)
  return size && (size[0] > size[1] ? 'landscape' : size[0] < size[1] ? 'portrait' : 'square')
}

/** Frame shape of a pixel size, for the ratio icon. */
export const resolutionShape = (value: string) => pixels(value)?.join(':') ?? ''

/** The supported value matching `value` exactly or by tier, so `720p` from an agent selects `1280x720`. */
export function matchResolution(value: string | undefined, options: string[]): string | undefined {
  if (!value) return undefined
  if (options.includes(value)) return value
  const tier = resolutionTier(value)
  const orientation = resolutionOrientation(value)
  return options.find(option => resolutionTier(option) === tier && (!orientation || resolutionOrientation(option) === orientation))
    ?? options.find(option => resolutionTier(option) === tier)
}

export interface VideoSettings {
  aspectRatio?: string
  resolution?: string
  duration?: number
  seed?: number
  generateAudio?: boolean
  watermark?: boolean
  cameraFixed?: boolean
  references?: MediaComposerReference[]
}

type Role = NonNullable<MediaComposerReference['role']>
export function referenceRoles(capabilities: MediaVideoCapabilities): Role[] {
  return [...(capabilities.references ? ['reference' as const] : []), ...(capabilities.firstFrame ? ['first' as const] : []), ...(capabilities.lastFrame ? ['last' as const] : [])]
}

/**
 * Keeps settings inside what a newly selected model reads. Unsupported choices fall back to Auto
 * (`allowAuto`) or the model's first option, switches it does not read are cleared, and references
 * take a role it accepts.
 */
export function fitVideoSettings<T extends VideoSettings>(settings: T, capabilities: MediaVideoCapabilities, allowAuto: boolean): T {
  const pick = <V,>(value: V | undefined, options: V[]) => value !== undefined && options.includes(value) ? value
    : allowAuto || !options.length ? undefined : options[0]
  const roles = referenceRoles(capabilities)
  const references = settings.references?.map(ref => roles.includes(ref.role ?? 'reference') ? ref : roles[0] ? { ...ref, role: roles[0] } : ref)
  return {
    ...settings,
    aspectRatio: pick(settings.aspectRatio || undefined, capabilities.aspectRatios),
    resolution: matchResolution(settings.resolution, capabilities.resolutions) ?? pick(undefined, capabilities.resolutions),
    duration: pick(settings.duration, capabilities.durations),
    seed: capabilities.seed ? settings.seed : undefined,
    generateAudio: capabilities.generateAudio ? settings.generateAudio : undefined,
    watermark: capabilities.watermark ? settings.watermark : undefined,
    cameraFixed: capabilities.cameraFixed ? settings.cameraFixed : undefined,
    ...(references ? { references } : {}),
  }
}

export function fitImageSettings<T extends { aspectRatio?: string; size?: string }>(settings: T, capabilities: MediaImageCapabilities): T {
  return {
    ...settings,
    aspectRatio: settings.aspectRatio && capabilities.aspectRatios.includes(settings.aspectRatio) ? settings.aspectRatio : undefined,
    size: settings.size && capabilities.sizes.includes(settings.size) ? settings.size : undefined,
  }
}
