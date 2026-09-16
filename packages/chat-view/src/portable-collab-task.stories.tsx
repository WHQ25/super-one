import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'
import { LONG_PRESS_DELAY_MS } from './long-press'

/**
 * The launch task a parent agent handed to this session, at phone width. It
 * mirrors the desktop `CollabTaskBubble`: right-aligned, real markdown, clipped
 * to half the viewport with an expand toggle. Copy lives in the same long-press
 * menu as any other user bubble.
 */
function taskMessage(text: string, fromSessionTitle: string | undefined = 'Mobile file preview review'): ChatMessage {
  return {
    id: 'collab-task',
    role: 'user',
    createdAt: '2026-09-09T00:00:00Z',
    status: 'complete',
    providerId: 'claude',
    content: [{ type: 'text', text }],
    metadata: {
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'parent-1', fromSessionTitle },
    },
  } as ChatMessage
}

const SHORT_TASK = 'Review the diff in `apps/mobile/src/ui/file-preview.tsx` and report anything that would regress on Android.'

const LONG_TASK = [
  '## Review request',
  '',
  'Please review the mobile file-preview change and report back with a **verdict**.',
  '',
  ...Array.from({ length: 24 }, (_, i) => `${i + 1}. Check step ${i + 1}: verify [file-preview.tsx](/repo/apps/mobile/src/ui/file-preview.tsx:${(i + 1) * 12}) still handles orientation changes.`),
  '',
  '```ts',
  'export function previewFile(path: string): void {',
  "  requestNative('previewFile', { path })",
  '}',
  '```',
  '',
  'Reply through the collaboration mailbox when done.',
].join('\n')

function TaskBubble({ message, width = 390 }: { message: ChatMessage; width?: number }) {
  return (
    <div className="p-4" style={{ width }}>
      <PortableMessage message={message} scheme="dark" pendingPermission={null} projectPath="/repo" />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable user message/Collab task',
  component: TaskBubble,
  args: { message: taskMessage(SHORT_TASK) },
} satisfies Meta<typeof TaskBubble>

export default meta
type Story = StoryObj<typeof meta>

export const Short: Story = {
  name: 'Short · right-aligned markdown, no toggle',
}

export const LongClipped: Story = {
  name: 'Long · clipped to half the viewport with Expand',
  args: { message: taskMessage(LONG_TASK) },
}

export const LongExpanded: Story = {
  name: 'Long · expanded via the toggle',
  args: { message: taskMessage(LONG_TASK) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Expand' }))
  },
}

export const LongPressMenu: Story = {
  name: 'Long-press · Copy menu hugs the right edge',
  play: async ({ canvasElement }) => {
    const bubble = canvasElement.querySelector<HTMLElement>('.portable-user-message')!
    const rect = bubble.getBoundingClientRect()
    const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    bubble.dispatchEvent(new PointerEvent('pointerdown', { ...at, isPrimary: true, pointerType: 'touch', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_DELAY_MS + 50))
    bubble.dispatchEvent(new PointerEvent('pointerup', { ...at, isPrimary: true, pointerType: 'touch', bubbles: true }))
  },
}

export const Narrow: Story = {
  name: 'Narrow · 320pt column',
  args: { message: taskMessage(LONG_TASK), width: 320 },
}

export const LongTitle: Story = {
  name: 'Long title · label truncates instead of wrapping',
  args: {
    message: taskMessage(SHORT_TASK, 'Investigate why the Android file preview loses orientation state after the keyboard closes'),
    width: 320,
  },
}

export const Untitled: Story = {
  name: 'Untitled parent · generic "Agent task" label',
  args: { message: taskMessage(SHORT_TASK, undefined) },
}
