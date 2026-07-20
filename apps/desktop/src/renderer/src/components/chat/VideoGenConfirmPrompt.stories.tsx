import type { Meta, StoryObj } from '@storybook/react-vite'
import { VideoGenConfirmPrompt, type VideoGenParams, type VideoGenProviderOption } from './VideoGenConfirmPrompt'

function placeholderImage(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},55%,55%)"/><text x="50%" y="50%" font-size="22" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const PROVIDERS: VideoGenProviderOption[] = [
  {
    id: 'ark',
    label: 'Volcengine Ark (Seedance)',
    models: [
      { id: 'seedance-1-pro', label: 'Seedance 1 Pro' },
      { id: 'seedance-1-lite', label: 'Seedance 1 Lite' },
    ],
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutions: ['480p', '720p', '1080p'],
  },
  {
    id: 'openai',
    label: 'OpenAI (Sora)',
    models: [{ id: 'sora-2', label: 'Sora 2' }],
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['1280x720', '720x1280', '1792x1024', '1024x1792'],
  },
  {
    id: 'google',
    label: 'Google (Veo)',
    models: [{ id: 'veo-3', label: 'Veo 3' }],
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
  },
]

const BASE_PARAMS: VideoGenParams = {
  prompt: 'A golden retriever runs across a sunlit beach at sunset, camera tracking alongside at a low angle, waves crashing gently in the background.',
  provider: 'ark',
  model: 'seedance-1-pro',
  aspectRatio: '16:9',
  resolution: '1080p',
  duration: 6,
  generateAudio: true,
  watermark: false,
  cameraFixed: false,
}

const meta: Meta<typeof VideoGenConfirmPrompt> = {
  title: 'Common/VideoGenConfirmPrompt',
  component: VideoGenConfirmPrompt,
  parameters: { layout: 'padded' },
  decorators: [(Story) => (
    <div className="@container" style={{ maxWidth: 820 }}>
      <Story />
    </div>
  )],
}

export default meta
type Story = StoryObj<typeof VideoGenConfirmPrompt>

export const TextToVideo: Story = {
  args: {
    params: BASE_PARAMS,
    providers: PROVIDERS,
    onConfirm: (params) => console.log('confirm', params),
    onReject: (feedback) => console.log('reject', feedback),
  },
}

export const ImageToVideoWithFrames: Story = {
  args: {
    params: {
      ...BASE_PARAMS,
      prompt: 'Animate the character walking forward from the start frame to the end frame, maintaining consistent lighting and camera position.',
      duration: 4,
    },
    providers: PROVIDERS,
    referenceImages: [
      { path: '/tmp/start.png', dataUri: placeholderImage(200, 'Start'), role: 'first_frame' },
      { path: '/tmp/end.png', dataUri: placeholderImage(20, 'End'), role: 'last_frame' },
    ],
    onConfirm: (params) => console.log('confirm', params),
    onReject: (feedback) => console.log('reject', feedback),
  },
}

export const WithReferenceImages: Story = {
  args: {
    params: {
      ...BASE_PARAMS,
      prompt: 'Show the same character from the reference images exploring a neon-lit cyberpunk street market at night.',
      provider: 'openai',
      model: 'sora-2',
      aspectRatio: '16:9',
      resolution: '1280x720',
      duration: 8,
    },
    providers: PROVIDERS,
    referenceImages: [
      { path: '/tmp/ref1.png', dataUri: placeholderImage(280, 'Ref 1'), role: 'reference' },
      { path: '/tmp/ref2.png', dataUri: placeholderImage(320, 'Ref 2'), role: 'reference' },
      { path: '/tmp/ref3.png', dataUri: placeholderImage(160, 'Ref 3'), role: 'reference' },
    ],
    onConfirm: (params) => console.log('confirm', params),
    onReject: (feedback) => console.log('reject', feedback),
  },
}

export const NoReferenceMedia: Story = {
  args: {
    params: {
      ...BASE_PARAMS,
      provider: 'google',
      model: 'veo-3',
      aspectRatio: '9:16',
      resolution: '1080p',
      duration: 5,
      generateAudio: false,
    },
    providers: PROVIDERS,
    onConfirm: (params) => console.log('confirm', params),
    onReject: (feedback) => console.log('reject', feedback),
  },
}
