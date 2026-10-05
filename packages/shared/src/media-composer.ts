/** Human media generation. Credentials and provider SDKs stay on the desktop Host. */
export type MediaComposerKind = 'image' | 'video'
export interface MediaComposerTarget { projectPath: string; sessionId: string }
export interface MediaComposerModel {
  providerId: string
  providerLabel: string
  model: string
  label: string
  default: boolean
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
