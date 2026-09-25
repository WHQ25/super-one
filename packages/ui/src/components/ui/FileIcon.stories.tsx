import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileIcon } from './FileIcon'

const meta: Meta<typeof FileIcon> = {
  title: 'UI/FileIcon',
  component: FileIcon,
  args: { name: 'scene.glb' },
}

export default meta
type Story = StoryObj<typeof FileIcon>

export const Default: Story = {}

/** Model formats next to Symbols icons, as they appear in a file tree. */
export const ModelFormats: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5 text-sm">
      {['photo.png', 'scene.glb', 'scene.gltf', 'rig.fbx', 'iphone.usdz', 'part.stl', 'mesh.obj', 'data.json'].map((name) => (
        <div key={name} className="flex items-center gap-1.5">
          <FileIcon name={name} />
          <span>{name}</span>
        </div>
      ))}
    </div>
  ),
}
