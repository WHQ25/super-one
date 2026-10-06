import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import { wrapPathRefMention } from '@superone/shared/user-mention-parser'
import { PortableMessage } from './PortableMessage'
import { PortableQueuedMessages } from './PortableQueuedMessages'

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4FmcDAAN+AXFyCQ1WAAAAAElFTkSuQmCC'
const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwa9oCAAKOAX3Ic40cAAAAAElFTkSuQmCC'

/** Queued on this phone: full bytes. */
const photo: ImageAttachment = { id: 'a1', name: 'IMG_0005.png', mimeType: 'image/png', base64: RED }
/** Queued on the desktop: the host sends a thumbnail and flags it. */
const fromDesktop: ImageAttachment = { id: 'a2', name: 'design.png', mimeType: 'image/png', base64: BLUE, preview: true }
/** A thumbnail the host could not cut arrives with no bytes. */
const uncut: ImageAttachment = { id: 'a3', name: 'loop.gif', mimeType: 'image/gif', base64: '', preview: true }
const pdf: ImageAttachment = { id: 'a4', name: 'quarterly-report.pdf', mimeType: 'application/pdf', base64: '', preview: true }

function user(id: string, text: string, attachments: ImageAttachment[] = []): ChatMessage {
  return {
    id, role: 'user', status: 'complete', providerId: 'local', createdAt: '2026-10-06T00:00:00Z',
    content: [
      ...attachments.map((a) => (a.mimeType === 'application/pdf'
        ? { type: 'document' as const, name: a.name, id: a.id }
        : { type: 'image' as const, name: a.name, id: a.id })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ],
    ...(attachments.length ? { attachments } : {}),
  }
}

const QUEUES = {
  text: [user('q1', 'Pause the refactor and fix the queued message interaction first.'), user('q2', 'Then add a Storybook story.')],
  attachments: [
    user('q1', 'Match the spacing in this screenshot', [photo]),
    user('q2', '', [fromDesktop, uncut]),
    user('q3', `The numbers are in ${wrapPathRefMention('file', '/project/docs/report.md', 'report.md')}`, [pdf]),
  ],
  long: [user('q1', 'A long queued message that checks the bubble wraps, the pictures wrap, and the actions stay aligned on a narrow phone without spilling off the edge. '.repeat(2), [photo, fromDesktop, uncut, { ...photo, id: 'a5' }, { ...fromDesktop, id: 'a6' }])],
}

/** The last sent turn and the queue after it, as the phone's chat document draws them. */
function QueueAfterTranscript({ queue, steer, width = 390, scheme = 'light' }: {
  queue: keyof typeof QUEUES
  steer: { now: boolean; soon: boolean }
  width?: number
  scheme?: 'light' | 'dark'
}) {
  return <div className="mx-auto space-y-4 p-4" style={{ width }}>
    <PortableMessage message={user('sent', 'Run the migration on the staging database', [photo])} scheme={scheme} pendingPermission={null} />
    <PortableQueuedMessages messages={QUEUES[queue]} steer={steer} scheme={scheme} mentionArtwork={{}} projectPath="/project" />
  </div>
}

const meta = {
  title: 'Chat/Mobile queued messages',
  component: QueueAfterTranscript,
  args: { queue: 'text', steer: { now: true, soon: true } },
  render: (args, context) => <QueueAfterTranscript {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof QueueAfterTranscript>
export default meta
type Story = StoryObj<typeof meta>

export const Claude: Story = {
  name: 'Claude · steer now and soon',
  play: async ({ canvas }) => {
    // The sent bubble keeps its long-press menu; a queued one has nothing to copy yet.
    await expect(canvas.getAllByRole('button', { name: 'Steer Soon (no interrupt)' })).toHaveLength(2)
    await expect(canvas.getAllByRole('button', { name: 'Edit Queued Message' })).toHaveLength(2)
  },
}
export const Codex: Story = { name: 'Codex · steer now only', args: { steer: { now: true, soon: false } } }
export const Idle: Story = { name: 'Turn ended · no steer, edit only', args: { steer: { now: false, soon: false } } }
export const Attachments: Story = { name: 'Attachments · own, from desktop, uncut, PDF, mention', args: { queue: 'attachments' } }
export const LongNarrow: Story = { name: 'Long text and many pictures · narrow', args: { queue: 'long', width: 320 } }
