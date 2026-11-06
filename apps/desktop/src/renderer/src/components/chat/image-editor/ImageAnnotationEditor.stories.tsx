import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { ImageAnnotationEditor, type ImageAnnotationEditorProps } from './ImageAnnotationEditor'

const fixture = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280"><rect width="480" height="280" fill="#e4e4e7"/><rect x="40" y="40" width="400" height="200" rx="16" fill="#fafafa"/><text x="240" y="145" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#18181b">Draw beyond this image</text></svg>`)}`

// Stories never write files or send attachments to a real conversation.
mockIpc('app', 'saveBrowserImage', async () => ({ ok: false, canceled: true }))
mockIpc('app', 'recognizeImageText', async () => ({ ok: true, texts: [] }))

function AttachmentExample(props: ImageAnnotationEditorProps) {
  const [saved, setSaved] = useState<string | null>(null)
  return saved ? (
    <div className="flex h-screen items-center justify-center bg-background p-8">
      <img src={saved} alt="Saved attachment with expanded canvas" className="max-h-full max-w-full" />
    </div>
  ) : (
    <ImageAnnotationEditor {...props} onReplaceAttachment={(base64, mimeType) => setSaved(`data:${mimeType};base64,${base64}`)} />
  )
}

const meta = {
  title: 'Chat/ImageAnnotationEditor',
  component: ImageAnnotationEditor,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen w-full"><Story /></div>],
  args: { src: fixture, alt: 'annotation-example.png', onExitEdit: () => {} },
} satisfies Meta<typeof ImageAnnotationEditor>
export default meta

type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Narrow: Story = {
  globals: { locale: 'zh' },
  decorators: [(Story) => <div className="h-screen w-[640px] max-w-full"><Story /></div>],
}
export const Attachment: Story = { render: (args) => <AttachmentExample {...args} /> }
