import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import i18n from 'i18next'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { ChatComposerShell } from '../ChatComposerShell'
import { ImageComposer } from './ImageComposer'
import { LONG_PROMPT, MediaComposerStory, imageResult, storyReference, type MediaStoryArgs } from './media-composer-story-fixtures'

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'connectClaude', async () => ({ models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }))
mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
mockIpc('app', 'getScheduledSend', async () => null)
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts']) mockIpc('app', method, async () => [])

const meta = {
  title: 'Chat/Media Composer/Image',
  render: args => <MediaComposerStory kind="image" Component={ImageComposer} {...args} />,
  parameters: { layout: 'padded' },
} satisfies Meta<MediaStoryArgs>
export default meta
type Story = StoryObj<typeof meta>

const prompt = 'An orange cat in an astronaut helmet on the Moon, Earth in the sky, film grain'
export const Empty: Story = { args: { value: {} } }
export const EmptyNarrow: Story = { args: { value: {}, width: 360 } }
export const TopAlignment: Story = {
  args: { width: 600 },
  render: args => <div className="flex items-end gap-6" style={{ width: (args.width ?? 760) * 2 + 24 }}>
    <div data-testid="default-composer" style={{ width: args.width ?? 760 }}><ChatComposerShell showTodoPopup={false} autoFocusOnMount={false} /></div>
    <MediaComposerStory kind="image" Component={ImageComposer} value={{}} width={args.width} />
  </div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('textbox', { name: i18n.t('mediaComposer.prompt') })).toHaveAttribute('placeholder', i18n.t('mediaComposer.imagePlaceholder'))
    await expect(canvas.queryByText(i18n.t('mediaComposer.dropReferences'))).not.toBeInTheDocument()
    await waitFor(() => {
      const textBox = canvasElement.querySelector('[data-chat-input-editor]')?.closest('.rounded-xl')
      const imageBox = canvasElement.querySelector('[data-media-composer="image"] > div')
      expect(textBox).not.toBeNull()
      expect(imageBox).not.toBeNull()
      expect(imageBox!.getBoundingClientRect().top).toBe(textBox!.getBoundingClientRect().top)
    })
  },
}
export const Ready: Story = {
  args: { value: { prompt, aspectRatio: '16:9', size: '2K' } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'Generate' })).toBeEnabled()
  },
}
export const SeedreamTiers: Story = { args: { value: { prompt, providerId: 'ark', model: 'seedream', size: '4K' } } }
export const WithReferences: Story = { args: { value: { prompt, references: [storyReference('cat.png'), storyReference('helmet.png')] } } }
export const AskAgent: Story = {
  args: { value: { prompt, runMode: 'agent', aspectRatio: '1:1' } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'Send' })).toBeEnabled()
  },
}
export const Generating: Story = { args: { value: { prompt }, run: { requestId: 'story-request' } } }
export const Results: Story = { args: { value: { prompt, aspectRatio: '1:1' }, run: { result: imageResult } } }
export const Failed: Story = { args: { value: { prompt }, run: { error: 'content_policy_violation: the provider rejected this prompt' } } }
export const NoModels: Story = { args: { value: { prompt }, models: 'empty' } }
export const LoadingModels: Story = { args: { value: { prompt }, models: 'loading' } }
export const ModelCatalogError: Story = { args: { value: { prompt }, models: 'error' } }
export const Inactive: Story = { args: { value: { prompt }, active: false } }
export const LongPrompt: Story = { args: { value: { prompt: LONG_PROMPT, references: [storyReference('cat.png')] } } }
export const Narrow: Story = { args: { value: { prompt, references: [storyReference('cat.png')], aspectRatio: '9:16', providerId: 'openai', model: 'gpt-image-1', size: '1024x1536' }, width: 360 } }
