import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

/**
 * A Codex subagent card on the phone. Its activity list matches the desktop card:
 * one compact, non-expandable row per call (Bash / Edit / `server` + tool / Web search).
 */
const RECEIVER = 'thread-reviewer'

const ACTIVITY: CodexThreadItem[] = [
  { id: 'cmd', type: 'command_execution', command: 'rg "DeferredTool" packages/chat-view/src', aggregatedOutput: '', status: 'completed', exitCode: 0 },
  { id: 'patch', type: 'file_change', status: 'completed', changes: [{ path: 'packages/chat-view/src/DeferredTool.tsx', kind: 'update' }] },
  { id: 'snap', type: 'mcp_tool_call', server: 'superone', tool: 'browser_snapshot', arguments: {}, status: 'completed', remoteDetail: '["turn","nested-item","[]"]' },
  { id: 'search', type: 'web_search', query: 'React Compiler bail out reasons', status: 'completed' },
  { id: 'fail', type: 'command_execution', command: 'bun run typecheck:web', aggregatedOutput: '', status: 'failed', exitCode: 2 },
]

function turn(running: boolean): ChatMessage {
  const childItems: CodexThreadItem[] = running
    ? ACTIVITY.slice(0, 3).map((item, index) => index === 2 && item.type === 'mcp_tool_call' ? { ...item, status: 'in_progress' } : item)
    : [...ACTIVITY, { id: 'reply', type: 'agent_message', text: 'The deferred row no longer renders the loaded item inside itself.' }]
  return {
    id: 'turn',
    role: 'assistant',
    providerId: 'codex',
    createdAt: '2026-09-23T00:00:00Z',
    status: running ? 'streaming' : 'complete',
    content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items: [{
      id: 'spawn',
      type: 'collab_tool_call',
      tool: 'spawnAgent',
      status: running ? 'in_progress' : 'completed',
      receiverThreadIds: [RECEIVER],
      prompt: 'Audit the phone transcript for tool rows nested inside tool rows.',
      agentsStates: { [RECEIVER]: { status: running ? 'running' : 'completed', nickname: 'reviewer', role: 'explorer', tokens: { input: 48_200, output: 3_100 } } },
      childItems: { [RECEIVER]: childItems },
    }] } },
  } as ChatMessage
}

function CodexSubagentTurn({ running = false, width = 390 }: { running?: boolean; width?: number }) {
  return (
    <div className="p-4" style={{ width }}>
      <PortableMessage message={turn(running)} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={running} />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable/Codex Subagent',
  component: CodexSubagentTurn,
  globals: { harness: 'codex' },
} satisfies Meta<typeof CodexSubagentTurn>

export default meta
type Story = StoryObj<typeof meta>

const expandCard = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector<HTMLElement>('.subagent-container > button')?.click()
}

export const Collapsed: Story = {}
export const ExpandedActivity: Story = { play: expandCard }
export const Running: Story = { args: { running: true }, play: expandCard }
export const Narrow: Story = { args: { width: 320 }, play: expandCard }
