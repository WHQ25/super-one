import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import type { VideoGenConfirmPayload } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { VideoConfirmComposer } from './VideoConfirmComposer'
import { LONG_PROMPT, storyCapabilities } from './media-composer-story-fixtures'

const placeholder = (hue: number, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${hue},55%,55%)"/><text x="50%" y="50%" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${label}</text></svg>`)}`
const providers: VideoGenConfirmPayload['providers'] = [
  { id: 'ark', label: 'Volcengine Ark', models: [{ id: 'seedance-1-pro', label: 'Seedance 1 Pro', capabilities: { ...storyCapabilities.seedance, generateAudio: false } },
    { id: 'seedance-1-5-pro', label: 'Seedance 1.5 Pro', capabilities: storyCapabilities.seedance }], aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['480p', '720p', '1080p'] },
  { id: 'google', label: 'Google', models: [{ id: 'veo-3', label: 'Veo 3', capabilities: storyCapabilities.veo }], aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'] },
]
const params: VideoGenConfirmPayload['params'] = {
  prompt: 'A golden retriever runs across a sunlit beach at sunset, camera tracking alongside at a low angle',
  provider: 'ark', model: 'seedance-1-5-pro', aspectRatio: '16:9', resolution: '1920x1080', duration: 6, generateAudio: true, watermark: false, cameraFixed: false,
}
interface Args { payload: VideoGenConfirmPayload; width?: number }

function ConfirmStory({ payload, width = 760 }: Args) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previousApp = window.app
    const previousRespond = useChatStore.getState().respondToPermission
    window.app = { ...previousApp, readFileAsDataUri: async (path: string) => ({ ok: true as const, dataUri: placeholder(path.length * 37 % 360, path.split('/').pop()!.replace('.png', '')) }) }
    useChatStore.setState({ respondToPermission: fn(async () => true).mockName('respondToPermission') })
    setReady(true)
    return () => { window.app = previousApp; useChatStore.setState({ respondToPermission: previousRespond }) }
  }, [])
  if (!ready) return null
  return <TooltipProvider><div style={{ width }}>
    <VideoConfirmComposer request={{ requestId: 'story', toolName: 'media_generate_video', input: {}, allowAlwaysAllow: false, requestKind: 'video_gen_confirm', videoGenConfirm: payload }} />
  </div></TooltipProvider>
}

const meta = {
  title: 'Chat/Media Composer/Video Confirmation',
  render: args => <ConfirmStory {...args} />,
  parameters: { layout: 'padded' },
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>

export const TextToVideo: Story = {
  args: { payload: { params, providers, referenceImages: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Generate' }))
    await expect(useChatStore.getState().respondToPermission).toHaveBeenCalled()
  },
}
export const StartAndEndFrames: Story = { args: { payload: { params: { ...params, duration: 4 }, providers, referenceImages: [
  { path: '/tmp/start.png', role: 'first_frame' }, { path: '/tmp/end.png', role: 'last_frame' },
] } } }
export const ReferenceImages: Story = { args: { payload: { params: { ...params, provider: 'google', model: 'veo-3', duration: 8 }, providers, referenceImages: [
  { path: '/tmp/ref-a.png', role: 'reference' }, { path: '/tmp/ref-b.png', role: 'reference' }, { path: '/tmp/ref-c.png', role: 'reference' },
] } } }
export const UnlistedModel: Story = { args: { payload: { params: { ...params, model: 'seedance-2-preview' }, providers, referenceImages: [] } } }
export const Reject: Story = {
  args: { payload: { params, providers, referenceImages: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Tell the agent what to change (optional)' }), 'Make it vertical')
    await userEvent.click(canvas.getByRole('button', { name: 'Reject' }))
    await expect(useChatStore.getState().respondToPermission).toHaveBeenCalledWith('story', false, undefined, undefined, undefined, undefined, { feedback: 'Make it vertical' }, undefined)
  },
}
export const LongPrompt: Story = { args: { payload: { params: { ...params, prompt: LONG_PROMPT }, providers, referenceImages: [{ path: '/tmp/start.png', role: 'first_frame' }] } } }
export const Narrow: Story = { args: { payload: { params, providers, referenceImages: [{ path: '/tmp/start.png', role: 'first_frame' }] }, width: 360 } }
