import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

/**
 * A subagent card on the phone, at phone width.
 *
 * The value here is the nested tool list: a running subagent can emit dozens of
 * calls, and the list is capped and scrolls instead of growing the card down the
 * transcript. Expand the card to inspect the cap and the follow-bottom behaviour.
 */
const TASK_ID = 'agent-1'

function taskBlock(status: 'streaming' | 'complete'): ContentBlock {
  return {
    type: 'tool_use',
    toolName: 'Agent',
    toolUseId: TASK_ID,
    status,
    input: JSON.stringify({
      subagent_type: 'explore',
      description: 'Find every tool row presenter',
      prompt: 'Search packages/chat-view for presenters that render a tool row and list them.',
    }),
  } as ContentBlock
}

/** `count` nested Read/Grep rows attributed to the task, all settled. */
function childRows(count: number): ContentBlock[] {
  return Array.from({ length: count }, (_, index): ContentBlock[] => {
    const id = `child-${index}`
    const isGrep = index % 3 === 0
    return [
      {
        type: 'tool_use',
        toolName: isGrep ? 'Grep' : 'Read',
        toolUseId: id,
        parentToolUseId: TASK_ID,
        status: 'complete',
        input: isGrep
          ? JSON.stringify({ pattern: 'ToolRow', path: 'packages/chat-view/src' })
          : JSON.stringify({ file_path: `/proj/packages/chat-view/src/presenters/File${index}.tsx` }),
        toolSummary: isGrep ? 'ToolRow in src' : `File${index}.tsx`,
        toolFilePath: isGrep ? undefined : `packages/chat-view/src/presenters/File${index}.tsx`,
      } as ContentBlock,
      { type: 'tool_result', toolUseId: id, parentToolUseId: TASK_ID, summary: 'ok' } as ContentBlock,
    ]
  }).flat()
}

function turn(content: ContentBlock[], status: 'streaming' | 'complete'): ChatMessage {
  return {
    id: 'subagent-turn',
    role: 'assistant',
    providerId: 'cursor',
    createdAt: '2026-09-09T00:00:00Z',
    status,
    content,
  } as ChatMessage
}

function SubagentTurn({ childCount, running }: { childCount: number; running: boolean }) {
  const status = running ? 'streaming' : 'complete'
  const content: ContentBlock[] = [
    { type: 'text', text: 'Delegating the search to a subagent.' } as ContentBlock,
    taskBlock(status),
    ...childRows(childCount),
    ...(running
      ? []
      : [{ type: 'tool_result', toolUseId: TASK_ID, summary: 'Found 12 presenters under `presenters/`.' } as ContentBlock]),
  ]
  return (
    <div className="w-[390px] p-4">
      <PortableMessage
        message={turn(content, status)}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={running}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable/Subagent',
  component: SubagentTurn,
} satisfies Meta<typeof SubagentTurn>

export default meta
type Story = StoryObj<typeof meta>

export const FewTools: Story = {
  name: 'Complete · three tools, no scroll',
  args: { childCount: 3, running: false },
}

export const ManyToolsRunning: Story = {
  name: 'Running · forty tools, list capped and scrollable',
  args: { childCount: 40, running: true },
}

export const ManyToolsComplete: Story = {
  name: 'Complete · forty tools, result below the capped list',
  args: { childCount: 40, running: false },
}
