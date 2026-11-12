import { createTwoFilesPatch } from 'diff'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import sampleVideo from '../../../../../../mobile/assets/preview/sample-clip.mp4?url'
import songWithCover from '../chat/__fixtures__/song-with-cover.mp3?url'
import { mediaDataUrl } from '../chat/__fixtures__/media-data-url'
import { FilePreview } from './FilePreview'

const ROOT = '/storybook'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e8e4f8"/><text x="24" y="100" font-size="28" fill="#3C3489">Preview</text></svg>'
const CODE_BASE = 'export function sum(a: number, b: number) {\n  const debug = false\n  return a + b\n}\n'
const CODE_NEXT = 'export function sum(a: number, b: number, offset = 0) {\n  return a + b + offset\n}\n'
const MD_DOC = '# Unified File Editor\n\nSwitch to **File** to inspect raw Markdown with gutter diff indicators.\n'

mockIpc('app', 'getMediaServerPort', async () => 0)
mockIpc('app', 'saveFileAs', async () => ({ ok: false, canceled: true }))
mockIpc('app', 'clipboardWriteImage', async () => ({ ok: true }))
mockIpc('app', 'revealFile', async () => {})
mockIpc('app', 'saveFile', async () => ({ ok: true }))
mockIpc('app', 'setUnsavedEditorBuffer', async () => {})
mockIpc('environment', 'mcpAppFileHandlers', async () => ({ ok: true, value: { handlers: [] } }))

function Preview({
  filePath,
  fileRoot,
  width = 720,
  height = 480,
  withDiff = false,
}: {
  filePath: string
  fileRoot?: string
  width?: number
  height?: number
  withDiff?: boolean
}) {
  useAppStore.setState({ currentFolder: ROOT, liquidGlass: false })
  mockIpc('app', 'getGitDiffFile', async () => ({
    path: filePath,
    diff: withDiff ? createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, CODE_BASE, CODE_NEXT) : '',
  }))
  mockIpc('app', 'readProjectFile', async () => {
    if (filePath.endsWith('.ts')) return { path: filePath, language: 'typescript', content: withDiff ? CODE_NEXT : CODE_BASE }
    if (filePath.endsWith('.md')) return { path: filePath, language: 'markdown', content: MD_DOC }
    if (filePath.endsWith('.svg')) return { path: filePath, language: 'svg', content: SVG }
    if (/\.(png|jpe?g|gif|webp)$/i.test(filePath)) return { path: filePath, language: 'image', content: PNG }
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

export const CodeClean: Story = { args: { filePath: 'src/math.ts' } }
export const CodeWithGitDiff: Story = {
  args: { filePath: 'src/math.ts' },
  render: (args) => <Preview {...args} withDiff />,
}
export const MarkdownWithSourceTab: Story = { args: { filePath: 'docs/guide.md' } }
export const Image: Story = { args: { filePath: 'shots/diagram.png' } }
export const Svg: Story = { args: { filePath: 'shots/mark.svg' } }
export const ImageNarrow: Story = { args: { filePath: 'shots/diagram.png' }, render: (args) => <Preview {...args} width={320} /> }
export const Video: Story = { args: { filePath: 'onboarding.mp4' } }
export const Audio: Story = { args: { filePath: 'song-with-cover.mp3' } }
export const VideoShortPane: Story = { args: { filePath: 'onboarding.mp4' }, render: (args) => <Preview {...args} height={240} /> }
export const AudioNarrow: Story = { args: { filePath: 'song-with-cover.mp3' }, render: (args) => <Preview {...args} width={320} /> }

export const RemoteSessionFile: Story = { args: { filePath: 'onboarding.mp4', fileRoot: 'remote:node:/worktree' } }
