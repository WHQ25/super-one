import type { Meta, StoryObj } from '@storybook/react-vite'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import sampleVideo from '../../../../../../mobile/assets/preview/sample-clip.mp4?url'
import songWithCover from '../chat/__fixtures__/song-with-cover.mp3?url'
import { mediaDataUrl } from '../chat/__fixtures__/media-data-url'
import { FilePreview } from './FilePreview'

const ROOT = '/storybook'
mockIpc('app', 'getMediaServerPort', async () => 0)
mockIpc('environment', 'mcpAppFileHandlers', async () => ({ ok: true, value: { handlers: [] } }))

function Preview({ filePath, fileRoot, width = 720, height = 480 }: { filePath: string; fileRoot?: string; width?: number; height?: number }) {
  useAppStore.setState({ currentFolder: ROOT })
  mockIpc('app', 'getGitDiffFile', async () => ({ path: filePath, diff: '' }))
  mockIpc('app', 'readProjectFile', async () => {
    const video = filePath.endsWith('.mp4')
    return {
      path: filePath,
      language: video ? 'video' : 'audio',
      content: await mediaDataUrl(video ? sampleVideo : songWithCover, video ? 'video/mp4' : 'audio/mpeg'),
    }
  })
  return (
    <div className="border border-border bg-background" style={{ width, maxWidth: '100%', height }}>
      <FilePreview filePath={filePath} fileRoot={fileRoot} />
    </div>
  )
}

const meta = {
  title: 'Coding/FilePreview',
  component: FilePreview,
  parameters: { layout: 'padded' },
  render: (args) => <Preview {...args} />,
} satisfies Meta<typeof FilePreview>
export default meta
type Story = StoryObj<typeof meta>

export const Video: Story = { args: { filePath: 'onboarding.mp4' } }
export const Audio: Story = { args: { filePath: 'song-with-cover.mp3' } }
export const VideoShortPane: Story = { args: { filePath: 'onboarding.mp4' }, render: (args) => <Preview {...args} height={240} /> }
export const AudioNarrow: Story = { args: { filePath: 'song-with-cover.mp3' }, render: (args) => <Preview {...args} width={320} /> }

export const RemoteSessionFile: Story = { args: { filePath: 'onboarding.mp4', fileRoot: 'remote:node:/worktree' } }
