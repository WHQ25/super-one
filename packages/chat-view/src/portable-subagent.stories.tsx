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

/**
 * What the progressive projection hands the phone for a named agent whose prompt
 * broke the shell cap: header fields kept, `prompt` dropped, children behind
 * `remoteDetail`. The name tag must show without expanding, like the desktop.
 */
function namedShell(toolUseId: string, name: string, description: string): ContentBlock {
  return {
    type: 'tool_use',
    toolName: 'Agent',
    toolUseId,
    status: 'complete',
    input: JSON.stringify({ description, name, subagent_type: 'general-purpose', model: 'fable' }),
    toolSummary: description,
    remoteDetail: JSON.stringify(['subagent-turn', 'tool', toolUseId]),
    taskUsage: { totalTokens: 153_511, toolUses: 39, durationMs: 369_226 },
  } as ContentBlock
}

function SubagentTurn({ childCount, running, named = 0 }: { childCount: number; running: boolean; named?: number }) {
  const status = running ? 'streaming' : 'complete'
  const content: ContentBlock[] = named > 0
    ? [
        { type: 'text', text: 'Fanning the review out to named reviewers.' } as ContentBlock,
        ...Array.from({ length: named }, (_, index): ContentBlock[] => [
          namedShell(`reviewer-${index}`, `reviewer-${index + 1}`, `Review chapter ${index + 1}`),
          { type: 'tool_result', toolUseId: `reviewer-${index}`, summary: `Chapter ${index + 1} looks fine.` } as ContentBlock,
        ]).flat(),
      ]
    : [
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

export const NamedCollapsedShell: Story = {
  name: 'Collapsed · named agent from a progressive shell (name tag without expanding)',
  args: { childCount: 0, running: false, named: 1 },
}

export const SeveralNamedAgents: Story = {
  name: 'Collapsed · four named agents, each card drawn in its own pool colour',
  args: { childCount: 0, running: false, named: 4 },
}
