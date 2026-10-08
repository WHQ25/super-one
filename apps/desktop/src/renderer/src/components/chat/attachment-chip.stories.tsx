import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AttachmentOriginalStatus, ImageAttachment } from '@superone/shared/agent-types'
import { AttachmentChipPresenter } from '@superone/chat-view/presenters/AttachmentChip'
import { DesktopUserBubblePorts } from './user-bubble-ports'

const PHOTO: ImageAttachment = {
  id: 'photo',
  name: 'IMG_4096x3072.png',
  mimeType: 'image/svg+xml',
  base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgMTAwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzM0ZDM5OSIvPjxjaXJjbGUgY3g9IjExNiIgY3k9IjMyIiByPSIxNCIgZmlsbD0iI2ZkZTA0NyIvPjxwYXRoIGQ9Ik0wIDEwMCA1MCA0NWw0MCA0MCAyMC0yMCA1MCAzNXoiIGZpbGw9IiMxNTgwM2QiLz48L3N2Zz4=',
  originalPath: '/sync/session/attachment/IMG_4096x3072.png',
}

/**
 * The composer chip of an image whose full-size original goes to a remote node
 * ahead of the message. Send waits for it. Hover a chip for its status line;
 * a failed upload offers Retry Upload, or asks to attach the image again.
 */
function Harness({ status, width = 560 }: { status: AttachmentOriginalStatus | undefined; width?: number }) {
  const [current, setCurrent] = useState(status)
  const att = PHOTO
  return (
    <div style={{ width }} className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
      <span>Use this as the first frame </span>
      <AttachmentChipPresenter
        att={att}
        original={{ status: current, onRetry: () => setCurrent({ state: 'uploading', progress: 0 }) }}
      />
      <span> and keep the colours.</span>
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Chat/AttachmentChip/Full-size Original',
  component: Harness,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <DesktopUserBubblePorts><Story /></DesktopUserBubblePorts>],
}

export default meta
type Story = StoryObj<typeof Harness>

/** On the node, or a local session: an ordinary chip. */
export const Ready: Story = { args: { status: { state: 'ready' } } }

/** Uploading: the dimmed thumbnail carries the progress ring; the hover card shows the percentage. */
export const Uploading: Story = { args: { status: { state: 'uploading', progress: 0.42 } } }

/** Before the first chunk lands: a short arc spins rather than a ring stuck at zero. */
export const UploadStarting: Story = { args: { status: { state: 'uploading', progress: 0 } } }

/** The upload gave up: Retry Upload in the hover card. */
export const Failed: Story = { args: { status: { state: 'failed', retryable: true } } }

/** The last chunk may already have landed (E090-3), so it cannot be retried: remove and attach again. */
export const FailedAfterCommit: Story = { args: { status: { state: 'failed', retryable: false } } }

/** Not polled yet: shown as ready until the first status arrives, so local chips never flicker. */
export const Unknown: Story = { args: { status: undefined } }

export const Narrow: Story = { args: { status: { state: 'uploading', progress: 0.8 }, width: 240 } }
