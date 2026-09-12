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
export const LongFileName: Story = { args: { message: sent('summarize this', [{ ...pdf, name: 'Q3-2026-board-deck-final-v7-with-appendix-and-notes.pdf' }]) } }
/** Loaded from the host: only a thumbnail travels; the tap fetches the original before the viewer opens. */
export const HostThumbnail: Story = { args: { message: sent('what is in this photo', [{ ...photo, preview: true }]) } }
/** A picture the host could not cut a thumbnail for (GIF, WebP), or a PDF: the icon stands in, the tap still fetches. */
export const WithoutBytes: Story = { args: { message: sent('what is in this photo', [{ ...photo, base64: '', preview: true }, { ...pdf, base64: '', preview: true }]) } }
export const NoText: Story = { args: { message: sent('', [photo, pdf]) } }
