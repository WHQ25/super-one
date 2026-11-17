import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { GitFileContent } from '@superone/shared/agent-types'
import { toLocalFileUrl } from '@/lib/path-utils'
import sample from '../../assets/computer-use-baseplate.png'
import sampleVideo from '../../../../../../mobile/assets/preview/sample-clip.mp4?url'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { GeneratedMediaGalleryBlock } from './GeneratedMediaGalleryBlock'

const root = 'remote:story-node:/home/node/project'
const nodePath = '/home/node/sync/story/media-gen/screenshot.png'
const nodeVideo = '/home/node/sync/story/media-gen/preview.mp4'
type Args = React.ComponentProps<typeof GeneratedMediaGalleryBlock> & { state: 'ready' | 'loading' | 'missing'; narrow: boolean }

const meta = {
  title: 'Chat/Media Gallery/Generated Media',
  args: { projectPath: root, items: [{ id: 'shot', type: 'image_generation', status: 'completed', savedPath: nodePath, revisedPrompt: 'Node screenshot' }], state: 'ready', narrow: false },
  render: ({ state, narrow, ...props }) => {
    mockIpc('app', 'getMediaServerPort', async () => Number(window.location.port))
    mockIpc('app', 'readProjectFile', async (_projectPath, requestedPath) => {
      const path = typeof requestedPath === 'string' ? requestedPath : nodePath
      if (state === 'loading') return new Promise<GitFileContent>(() => {})
      if (state === 'missing') return { path: nodePath, content: '', language: 'text', error: 'missing' }
      const video = path.endsWith('.mp4')
      return {
        path,
        content: toLocalFileUrl(new URL(video ? sampleVideo : sample, window.location.href).pathname),
        language: video ? 'video' : 'image',
      }
    })
    return <div style={{ width: narrow ? 320 : 640 }}><GeneratedMediaGalleryBlock {...props} /></div>
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

const mixedItems: React.ComponentProps<typeof GeneratedMediaGalleryBlock>['items'] = [
  { id: 'preview', type: 'video_generation', status: 'completed', savedPath: nodeVideo },
  { id: 'cover', type: 'image_generation', status: 'completed', savedPath: nodePath, revisedPrompt: 'Node screenshot' },
  { id: 'failed', type: 'image_generation', status: 'failed' },
]

export const Mixed: Story = {
  args: { items: mixedItems },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /screenshot.png/ }))
    await expect(await canvas.findByRole('button', { name: 'Node screenshot' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse Media Sidebar' }))
    await expect(canvas.getByRole('button', { name: 'Expand Media Sidebar' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Expand Media Sidebar' }))
    await expect(canvas.getByRole('button', { name: /screenshot.png/ })).toHaveAttribute('aria-pressed', 'true')
  },
}

export const MixedDarkNarrow: Story = {
  args: { items: mixedItems, narrow: true },
  globals: { theme: 'dark', locale: 'zh' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('1/3')).resolves.toBeVisible()
    canvas.getByRole('button', { name: '下一项媒体' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.findByText('2/3')).resolves.toBeVisible()
  },
}
