import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '@/stores/app'
import { FileChip } from './FileChip'

const PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#34d399"/><circle cx="116" cy="32" r="14" fill="#fde047"/><path d="M0 100 50 45l40 40 20-20 50 35" fill="#15803d"/></svg>')

/** Exercise the production remote-media path without a node or local filesystem. */
function Fixture({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const read = window.app.readProjectFile
    const folder = useAppStore.getState().currentFolder
    window.app.readProjectFile = async (_root, path) => ({ path, language: 'image', content: path.includes('missing') ? '' : PHOTO })
    useAppStore.setState({ currentFolder: 'remote:storybook:/project' })
    setReady(true)
    return () => { window.app.readProjectFile = read; useAppStore.setState({ currentFolder: folder }) }
  }, [])
  return ready ? children : null
}

const meta: Meta<typeof FileChip> = {
  title: 'Chat/FileChip/Image preview', component: FileChip,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <Fixture><Story /></Fixture>],
  args: { name: 'landscape.png', title: 'landscape.png', filePath: 'landscape.png' },
}
export default meta
type Story = StoryObj<typeof FileChip>
export const Image: Story = {}
export const MissingImage: Story = { args: { name: 'missing.png', filePath: '/missing-image.png' } }
export const NonImage: Story = { args: { name: 'README.md', filePath: '/README.md' } }
export const NarrowLongName: Story = { args: { name: 'a-very-long-image-file-name-for-narrow-layout.png', className: 'max-w-40' } }
