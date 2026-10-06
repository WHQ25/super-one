/** Human media generation. Credentials and provider SDKs stay on the desktop Host. */
export type MediaComposerKind = 'image' | 'video'
export interface MediaComposerTarget { projectPath: string; sessionId: string }
/** What an image adapter reads. An empty list means the control does not apply. */
export interface MediaImageCapabilities {
  aspectRatios: string[]
  /** `size` values: pixel sizes (`1024x1536`) or resolution tiers (`2K`). */
  sizes: string[]
}
/** What a video adapter reads. An empty list or `false` means the control does not apply. */
export interface MediaVideoCapabilities {
  aspectRatios: string[]
  /** `resolution` values, always pixel sizes; adapters map them onto their own tiers. */
  resolutions: string[]
  durations: number[]
  seed: boolean
  generateAudio: boolean
  watermark: boolean
  cameraFixed: boolean
  firstFrame: boolean
  lastFrame: boolean
  references: boolean
}
export interface MediaComposerModel {
  providerId: string
  providerLabel: string
  model: string
  label: string
  default: boolean
  image?: MediaImageCapabilities
  video?: MediaVideoCapabilities
}
export interface MediaComposerReference {
  name: string
  mediaType: string
  base64: string
  role?: 'reference' | 'first' | 'last'
}
export interface MediaComposerRequest extends MediaComposerTarget {
  requestId: string
  kind: MediaComposerKind
  providerId: string
  model: string
  prompt: string
  references?: MediaComposerReference[]
  size?: string
  aspectRatio?: string
  duration?: number
  resolution?: string
  seed?: number
  generateAudio?: boolean
  watermark?: boolean
  cameraFixed?: boolean
}
export interface MediaComposerFile {
  /** Desktop path, for preview, copying and saving. */
  path: string
  /** Node path after sync-zone delivery; used when handing a video to a remote agent. */
  agentPath: string
  mediaType: string
  base64?: string
}
export interface MediaComposerResult {
  generationId: string
  kind: MediaComposerKind
  status: 'running' | 'succeeded' | 'failed'
  files: MediaComposerFile[]
  error?: string
}
export interface MediaComposerAPI {
  mediaModels(kind: MediaComposerKind): Promise<MediaComposerModel[]>
  mediaGenerate(request: MediaComposerRequest): Promise<MediaComposerResult>
  mediaCancel(requestId: string): Promise<void>
  mediaVideoStatus(target: MediaComposerTarget, generationId: string): Promise<MediaComposerResult>
  mediaPendingVideos(target: MediaComposerTarget): Promise<MediaComposerResult[]>
}
export const MediaComposerChannels = {
  models: 'media:models', generate: 'media:generate', cancel: 'media:cancel',
  videoStatus: 'media:video-status', pendingVideos: 'media:pending-videos',
} as const
