import type { MediaProviderKind } from './types'

export interface MediaModelPreset {
  id: string
  label: string
}

export type MediaCategory = 'image' | 'video' | 'audio'

export interface MediaProviderPreset {
  id: string
  kind: MediaProviderKind
  label: string
  defaultBaseURL?: string
  apiKeyEnv?: string
  categories: MediaCategory[]
  defaultModel: string
  models: MediaModelPreset[]
}

export const MEDIA_PROVIDER_PRESETS: MediaProviderPreset[] = [
  {
    id: 'openai',
    kind: 'openai',
    label: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    categories: ['image'],
    defaultModel: 'gpt-image-2',
    models: [{ id: 'gpt-image-2', label: 'GPT Image 2' }],
  },
  {
    id: 'google',
    kind: 'google',
    label: 'Google Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    categories: ['image'],
    defaultModel: 'gemini-3.1-flash-image-preview',
    models: [
      { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
      { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
      { id: 'gemini-2.5-flash-image', label: 'Nano Banana' },
    ],
  },
]

export function getMediaProviderPreset(id: string): MediaProviderPreset | undefined {
  return MEDIA_PROVIDER_PRESETS.find((preset) => preset.id === id)
}
