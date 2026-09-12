import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4FmcDAAN+AXFyCQ1WAAAAAElFTkSuQmCC'
const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwa9oCAAKOAX3Ic40cAAAAAElFTkSuQmCC'

const photo: ImageAttachment = { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/png', base64: RED }
const screenshot: ImageAttachment = { id: 'a2', name: 'Screenshot 2026-09-12 at 16.55.03 with a very long file name.png', mimeType: 'image/png', base64: BLUE }
const pdf: ImageAttachment = { id: 'a3', name: 'quarterly-report.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' }

function sent(text: string, attachments: ImageAttachment[]): ChatMessage {
  return {
    id: `user_${attachments.map((a) => a.id).join('_') || 'text'}`, role: 'user', status: 'complete', providerId: 'local',
    createdAt: new Date().toISOString(),
    content: [
      ...attachments.map((a) => (a.mimeType === 'application/pdf'
        ? { type: 'document' as const, name: a.name, id: a.id }
        : { type: 'image' as const, name: a.name, id: a.id })),
      { type: 'text', text },
    ],
    attachments,
  }
}

/** A user bubble in the phone's chat WebView with the attachments it was sent with. */
function AttachmentBubble({ message, scheme = 'light' }: { message: ChatMessage; scheme?: 'light' | 'dark' }) {
  return <div className="mx-auto w-full max-w-[430px] p-4">
    <PortableMessage message={message} scheme={scheme} pendingPermission={null} />
  </div>
}

const meta = { title: 'Chat/Mobile attachment chip', component: AttachmentBubble,
  render: (args, context) => <AttachmentBubble {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof AttachmentBubble>
export default meta
type Story = StoryObj<typeof meta>

export const OnePicture: Story = { args: { message: sent('what is in this photo', [photo]) } }
export const SeveralPictures: Story = { args: { message: sent('describe these', [photo, screenshot, photo]) } }
export const Pdf: Story = { args: { message: sent('summarize the numbers', [pdf]) } }
export const LongFileName: Story = { args: { message: sent('is the layout broken here?', [screenshot]) } }
/** The host's echo to the sender, or history whose bytes were dropped: the icon stands in. */
export const WithoutBytes: Story = { args: { message: sent('what is in this photo', [{ ...photo, base64: '' }]) } }
export const NoText: Story = { args: { message: sent('', [photo, pdf]) } }
