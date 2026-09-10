import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { wrapPathRefMention } from '@superone/shared/user-mention-parser'
import { PortableMessage } from './PortableMessage'
import { LONG_PRESS_DELAY_MS } from './long-press'

/**
 * The long-press copy menu over a user bubble, at phone width. On a device the
 * gesture also asks the shell for a haptic tick; here that request goes to the
 * story's `parent.postMessage` and is simply ignored.
 */
function userMessage(text: string, metadata?: ChatMessage['metadata']): ChatMessage {
  return {
    id: 'user-turn',
    role: 'user',
    createdAt: '2026-09-09T00:00:00Z',
    status: 'complete',
    content: [{ type: 'text', text }],
    ...(metadata ? { metadata } : {}),
  } as ChatMessage
}

function UserBubble({ message, topOffset = 160 }: { message: ChatMessage; topOffset?: number }) {
  return (
    <div className="w-[390px] p-4" style={{ paddingTop: topOffset }}>
      <PortableMessage message={message} scheme="dark" pendingPermission={null} />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable user message/Long-press menu',
  component: UserBubble,
  args: { message: userMessage('Refactor the composer so the attachment strip sits above the input.') },
} satisfies Meta<typeof UserBubble>

export default meta
type Story = StoryObj<typeof meta>

/** Press-and-hold on the bubble; resolves once the menu is up. */
async function longPress(canvasElement: HTMLElement) {
  const bubble = canvasElement.querySelector<HTMLElement>('.portable-user-message')!
  const rect = bubble.getBoundingClientRect()
  const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
  bubble.dispatchEvent(new PointerEvent('pointerdown', { ...at, isPrimary: true, pointerType: 'touch', bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_DELAY_MS + 50))
  bubble.dispatchEvent(new PointerEvent('pointerup', { ...at, isPrimary: true, pointerType: 'touch', bubbles: true }))
}

export const Idle: Story = {
  name: 'Idle · long-press the bubble to open',
}

export const Open: Story = {
  name: 'Open · Copy above the bubble, right-aligned',
  play: async ({ canvasElement }) => { await longPress(canvasElement) },
}

export const Copied: Story = {
  name: 'Copied · confirmation, then folds away',
  play: async ({ canvasElement, canvas, userEvent }) => {
    await longPress(canvasElement)
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Copy' }))
  },
}

export const Collaboration: Story = {
  name: 'Collaboration bubble · menu hugs the left edge',
  args: {
    message: userMessage('Please review the diff and report back.', {
      source: 'collaboration',
      collaboration: { kind: 'mailbox', direction: 'outbound' },
    }),
  },
  play: async ({ canvasElement }) => { await longPress(canvasElement) },
}

export const NearTop: Story = {
  name: 'Near the top · menu flips below the bubble',
  args: { topOffset: 4 },
  play: async ({ canvasElement }) => { await longPress(canvasElement) },
}

export const LongContent: Story = {
  name: 'Long content · mentions copy as their chip labels',
  args: {
    message: userMessage([
      `Compare ${wrapPathRefMention('file', '/repo/apps/mobile/src/screens/chat-composer.tsx', 'chat-composer.tsx')} with`,
      `${wrapPathRefMention('file', '/repo/apps/mobile/src/ui/composer-panel.tsx', 'composer-panel.tsx')} and list every place the`,
      'attachment strip is measured. Then propose a layout where the strip sits above the input',
      'without pushing the send button off the row on a 320pt-wide screen.',
    ].join(' ')),
  },
  play: async ({ canvasElement }) => { await longPress(canvasElement) },
}

export const Interrupted: Story = {
  name: 'Interrupted · still copyable',
  args: { message: { ...userMessage('Run the full test suite.'), status: 'interrupted' } as ChatMessage },
  play: async ({ canvasElement }) => { await longPress(canvasElement) },
}
