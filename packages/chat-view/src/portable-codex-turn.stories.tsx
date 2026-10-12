import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, CodexPlanApprovalState, CodexThreadItem } from '@superone/shared/agent-types'
import { withCodexContent } from '@superone/shared/codex-content'
import { PortableMessage } from './PortableMessage'

/**
 * A legacy Codex turn on the phone, drawn by the shared turn body from the
 * content the phone derives at ingress: reasoning, parsed commands, a patch,
 * review markers, an error notice and the proposed plan.
 */
const PLAN = '1. Read the transcript renderer.\n2. Move Codex rows onto the shared turn body.\n3. Delete the Codex-only view.'

const ITEMS: CodexThreadItem[] = [
  { id: 'reason', type: 'reasoning', text: 'Check how the phone renders a Codex turn before changing it.' },
  { id: 'review-start', type: 'review', phase: 'entered', text: '' },
  { id: 'read', type: 'command_execution', command: 'cat packages/chat-view/src/PortableMessage.tsx', aggregatedOutput: 'export const PortableMessage = memo(…)', status: 'completed', exitCode: 0,
    commandActions: [{ type: 'read', name: 'PortableMessage.tsx', path: 'packages/chat-view/src/PortableMessage.tsx', command: 'cat packages/chat-view/src/PortableMessage.tsx' }] },
  { id: 'test', type: 'command_execution', command: 'bun run test', aggregatedOutput: '1 failed', status: 'completed', exitCode: 1 },
  { id: 'patch', type: 'file_change', status: 'completed', changes: [
    { path: 'packages/chat-view/src/PortableMessage.tsx', kind: 'update', diff: '@@ -1,2 +1,2 @@\n-const isCodex = true\n+const isCodex = false\n' },
  ] },
  { id: 'review-end', type: 'review', phase: 'exited', text: 'No blocking findings.' },
  { id: 'warning', type: 'error', message: 'The sandbox denied network access for one command.' },
  { id: 'plan', type: 'plan', text: PLAN },
]

function turn(streaming: boolean, planApproval?: CodexPlanApprovalState): ChatMessage {
  const items = streaming
    ? ITEMS.slice(0, 4).map(item => item.id === 'test' && item.type === 'command_execution' ? { ...item, status: 'in_progress' as const, exitCode: undefined } : item)
    : ITEMS
  return withCodexContent({
    id: 'codex-turn',
    role: 'assistant',
    providerId: 'codex',
    createdAt: '2026-10-12T00:00:00Z',
    status: streaming ? 'streaming' : 'complete',
    content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items, ...(planApproval ? { planApproval } : {}) } },
  })
}

function CodexTurn({ streaming = false, planApproval, isLastAssistant = true, width = 390, scheme = 'light' }: {
  streaming?: boolean
  planApproval?: CodexPlanApprovalState
  isLastAssistant?: boolean
  width?: number
  scheme?: 'light' | 'dark'
}) {
  return (
    <div className="p-4" style={{ width }}>
      <PortableMessage message={turn(streaming, planApproval)} scheme={scheme} pendingPermission={null}
        isLastAssistant={isLastAssistant} sessionStreaming={streaming} />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable/Codex Turn',
  component: CodexTurn,
  globals: { harness: 'codex' },
  render: (args, context) => <CodexTurn {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof CodexTurn>

export default meta
type Story = StoryObj<typeof meta>

/** Opens the plan card, whose body holds the approval actions. */
async function openPlan({ canvasElement }: { canvasElement: HTMLElement }) {
  canvasElement.querySelector('.lucide-clipboard-list')?.closest<HTMLElement>('div')?.click()
}

/** The latest settled plan offers the approval actions. */
export const PlanAwaitingApproval: Story = { play: openPlan }
export const PlanApproved: Story = { args: { planApproval: { status: 'approved' } }, play: openPlan }
export const PlanRejected: Story = { args: { planApproval: { status: 'rejected', feedback: 'Keep the Codex view for one more release.' } } }
/** An older turn's plan is history: no actions. */
export const EarlierTurn: Story = { args: { isLastAssistant: false }, play: openPlan }
export const Streaming: Story = { args: { streaming: true } }
export const Narrow: Story = { args: { width: 320 }, play: openPlan }
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' } }
