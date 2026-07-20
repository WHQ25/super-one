import type { ProviderOptions } from '@ai-sdk/provider-utils'

export type MediaProviderKind = 'openai' | 'google' | 'openai-compatible' | 'ark' | 'newapi'

export interface MediaProviderConfig {
  id: string
  kind: MediaProviderKind
  apiKey: string
  baseURL?: string
  models?: string[]
}

export interface ReferenceImage {
  mediaType: string
  data: Uint8Array | string
}

export interface GenerateMediaCoreParams {
  provider: MediaProviderConfig
  model: string
  prompt: string
  referenceImages?: ReferenceImage[]
  mask?: Uint8Array | string
  size?: string
  aspectRatio?: string
  n?: number
  seed?: number
  providerOptions?: ProviderOptions
  abortSignal?: AbortSignal
}

export interface SavedImage {
  path: string
  mediaType: string
  /** Absent for video, whose files are too large to keep a second in-memory copy of. */
  base64?: string
}

export interface MediaCoreResult {
  images: SavedImage[]
  warnings: unknown[]
  providerMetadata?: unknown
}
