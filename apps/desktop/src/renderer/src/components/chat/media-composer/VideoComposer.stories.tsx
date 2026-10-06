import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { VideoComposer } from './VideoComposer'
import { LONG_PROMPT, MediaComposerStory, storyReference, type MediaStoryArgs } from './media-composer-story-fixtures'

const meta = {
  title: 'Chat/Media Composer/Video',
  render: args => <MediaComposerStory kind="video" Component={VideoComposer} {...args} />,
  parameters: { layout: 'padded' },
} satisfies Meta<MediaStoryArgs>
export default meta
type Story = StoryObj<typeof meta>

const prompt = 'The camera slowly pushes in as the cat looks up at the Earth, its visor reflecting blue light'
const running = { result: { generationId: 'story-video', kind: 'video' as const, status: 'running' as const, files: [] } }
export const Empty: Story = { args: { value: {} } }
export const MoreSettings: Story = {
  args: { value: { prompt, aspectRatio: '16:9', resolution: '1920x1080', duration: 8, generateAudio: true, seed: 42 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'More Settings' }))
    await expect(await within(canvasElement.ownerDocument.body).findByRole('switch', { name: 'Generate Audio' })).toHaveAttribute('aria-checked', 'true')
  },
}
export const OverflowToSettings: Story = {
  args: { value: { prompt, aspectRatio: '9:16', resolution: '1280x720', duration: 5, watermark: true }, width: 520 },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'More Settings' })).toBeInTheDocument()
  },
}
export const SoraSizes: Story = { args: { value: { prompt, providerId: 'openai', model: 'sora-2', resolution: '720x1280', duration: 8 } } }
export const Ready: Story = {
  args: { value: { prompt, aspectRatio: '16:9', duration: 8, resolution: '1920x1080' } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'Duration: 8 s' })).toBeInTheDocument()
  },
}
export const FramesAndReferences: Story = { args: { value: { prompt, references: [storyReference('start.png', 'first'), storyReference('end.png', 'last'), storyReference('style.png')] } } }
export const AskAgent: Story = { args: { value: { prompt, runMode: 'agent' } } }
export const Submitting: Story = { args: { value: { prompt }, run: { requestId: 'story-request' } } }
export const Pending: Story = { args: { value: { prompt }, run: running } }
export const PendingPaused: Story = { args: { value: { prompt, paused: true }, run: running } }
export const StatusError: Story = { args: { value: { prompt }, run: { ...running, error: 'Network request failed' } } }
export const NoModels: Story = { args: { value: { prompt }, models: 'empty' } }
export const LongPrompt: Story = { args: { value: { prompt: LONG_PROMPT } } }
export const Narrow: Story = { args: { value: { prompt, references: [storyReference('start.png', 'first')], duration: 5 }, run: running, width: 360 } }
