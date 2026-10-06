import { useEffect, useState, type ComponentType } from 'react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import type { MediaComposerAPI, MediaComposerKind, MediaComposerResult, MediaImageCapabilities, MediaVideoCapabilities } from '@superone/shared/media-composer'
import type { OpenedComposerProps } from '../composer-slot/composer-registry'
import type { ComposerValue } from '../composer-slot/composer-stack'
import { useMediaRuns, type MediaRun } from './media-composer-runs'

export const storyTarget = { projectPath: '/preview', sessionId: 'preview' }
export const storyReference = (name: string, role: 'reference' | 'first' | 'last' = 'reference') =>
  ({ name, mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64, role })
export const imageResult: MediaComposerResult = { generationId: 'story-image', kind: 'image', status: 'succeeded', files: [
  { path: '/preview/generated-1.png', agentPath: '/preview/generated-1.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64 },
  { path: '/preview/generated-2.png', agentPath: '/preview/generated-2.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64 },
] }
/** Mirrors the main-process capability table for the adapters shown in stories. */
export const storyCapabilities = {
  gemini: { aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], sizes: ['1K', '2K', '4K'] },
  gptImage: { aspectRatios: [], sizes: ['1024x1024', '1536x1024', '1024x1536'] },
  seedream: { aspectRatios: [], sizes: ['2K', '4K'] },
  seedance: { aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], resolutions: ['854x480', '1280x720', '1920x1080'],
    durations: Array.from({ length: 14 }, (_, index) => index + 2), seed: true, generateAudio: true, watermark: true, cameraFixed: true,
    firstFrame: true, lastFrame: true, references: true },
  veo: { aspectRatios: ['16:9', '9:16'], resolutions: ['1280x720', '1920x1080'], durations: [4, 6, 8], seed: true, generateAudio: false,
    watermark: false, cameraFixed: false, firstFrame: true, lastFrame: true, references: true },
  sora: { aspectRatios: [], resolutions: ['1280x720', '720x1280', '1792x1024', '1024x1792'], durations: [4, 8, 12], seed: false,
    generateAudio: false, watermark: false, cameraFixed: false, firstFrame: false, lastFrame: false, references: false },
} satisfies Record<string, MediaImageCapabilities | MediaVideoCapabilities>
export const LONG_PROMPT = 'A cinematic wide shot of an orange cat in an astronaut helmet sitting on the lunar surface, the Earth rising behind it, soft rim light on the visor, fine film grain, muted teal and amber palette, '.repeat(4)

export interface MediaStoryArgs {
  value?: ComposerValue
  run?: MediaRun
  models?: 'ready' | 'empty' | 'loading' | 'error'
  active?: boolean
  /** Composer width in pixels; the toolbar moves what does not fit into the settings panel. */
  width?: number
}

/** Renders a user-started media composer with a fixture media API and an optional seeded run. */
export function MediaComposerStory({ kind, Component, value: initial = {}, run, models = 'ready', active = true, width = 760 }: MediaStoryArgs & {
  kind: MediaComposerKind; Component: ComponentType<OpenedComposerProps>
}) {
  const instanceId = `story-${kind}`
  const [value, setValue] = useState<ComposerValue>(initial)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = window.environment
    const fixture: MediaComposerAPI = {
      mediaModels: async () => {
        if (models === 'loading') return new Promise(() => {})
        if (models === 'error') throw new Error('Provider catalog is unavailable')
        return models === 'empty' ? [] : kind === 'image' ? [
          { providerId: 'google', providerLabel: 'Google', model: 'gemini-image', label: 'Gemini 2.5 Flash Image', default: true, image: storyCapabilities.gemini },
          { providerId: 'openai', providerLabel: 'OpenAI', model: 'gpt-image-1', label: 'GPT Image 1', default: false, image: storyCapabilities.gptImage },
          { providerId: 'ark', providerLabel: 'Volcengine Ark', model: 'seedream', label: 'Seedream 4.0', default: false, image: storyCapabilities.seedream },
        ] : [
          { providerId: 'ark', providerLabel: 'Volcengine Ark', model: 'seedance-1-5-pro', label: 'Seedance 1.5 Pro', default: true, video: storyCapabilities.seedance },
          { providerId: 'google', providerLabel: 'Google', model: 'veo-3', label: 'Veo 3', default: false, video: storyCapabilities.veo },
          { providerId: 'openai', providerLabel: 'OpenAI', model: 'sora-2', label: 'Sora 2', default: false, video: storyCapabilities.sora },
        ]
      },
      mediaGenerate: async request => ({ generationId: request.requestId, kind: request.kind, status: request.kind === 'image' ? 'succeeded' : 'running',
        files: request.kind === 'image' ? imageResult.files : [] }),
      mediaCancel: async () => {}, mediaPendingVideos: async () => [],
      mediaVideoStatus: async (_target, generationId) => ({ generationId, kind: 'video', status: 'running', files: [] }),
    }
    window.environment = { ...previous, ...fixture }
    useMediaRuns.setState(state => ({ runs: { ...state.runs, [instanceId]: run ?? {} } }))
    setReady(true)
    return () => {
      window.environment = previous
      useMediaRuns.setState(state => { const runs = { ...state.runs }; delete runs[instanceId]; return { runs } })
    }
  }, [instanceId, kind, models, run])
  if (!ready) return null
  return (
    <TooltipProvider>
      <div style={{ width }}>
        <Component instanceId={instanceId} lifetime="sticky" session={storyTarget} value={value} onValueChange={setValue}
          active={active} submit={result => console.info('[media-composer] submit', result)} cancel={() => console.info('[media-composer] exit')} />
      </div>
    </TooltipProvider>
  )
}
