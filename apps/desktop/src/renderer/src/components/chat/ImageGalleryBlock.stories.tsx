import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { GitFileContent } from '@superone/shared/agent-types'
import { toLocalFileUrl } from '@/lib/path-utils'
import sample from '../../assets/computer-use-baseplate.png'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ImageGalleryBlock } from './ImageGalleryBlock'

const root = 'remote:story-node:/home/node/project'
const nodePath = '/home/node/sync/story/media-gen/screenshot.png'
type Args = React.ComponentProps<typeof ImageGalleryBlock> & { state: 'ready' | 'loading' | 'missing'; narrow: boolean }

const meta = {
  title: 'Chat/Media Gallery/Node Images',
  args: { projectPath: root, items: [{ id: 'shot', type: 'image_generation', status: 'completed', savedPath: nodePath, revisedPrompt: 'Node screenshot' }], state: 'ready', narrow: false },
  render: ({ state, narrow, ...props }) => {
    mockIpc('app', 'getMediaServerPort', async () => Number(window.location.port))
    mockIpc('app', 'readProjectFile', async () => {
      if (state === 'loading') return new Promise<GitFileContent>(() => {})
      if (state === 'missing') return { path: nodePath, content: '', language: 'text', error: 'missing' }
      return { path: nodePath, content: toLocalFileUrl(new URL(sample, window.location.href).pathname), language: 'image' }
    })
    return <div style={{ width: narrow ? 320 : 640 }}><ImageGalleryBlock {...props} /></div>
  },
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>

export const RemoteMirror: Story = {}
export const ProjectImage: Story = {
  args: { items: [{ id: 'project-image', type: 'image_generation', status: 'completed', savedPath: '/home/node/project/output/image.png', revisedPrompt: 'Node project image' }] },
}
export const Loading: Story = { args: { state: 'loading' } }
export const Missing: Story = { args: { state: 'missing' } }
export const Empty: Story = { args: { items: [] } }
export const DarkNarrow: Story = { args: { narrow: true }, globals: { theme: 'dark', locale: 'zh' } }
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Node screenshot' }))
    await expect(within(document.body).getByRole('dialog')).toBeVisible()
  },
}
