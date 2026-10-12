import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType, CodexCommandAction, CodexThreadItem } from '@superone/shared/agent-types'
import { codexItemsToContent } from '@superone/shared/codex-content'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatMessage } from './ChatMessage'

/**
 * Codex thread items translated into content blocks (`codex-content.ts`) and drawn by the
 * shared turn body, the path every harness's turn takes. Items are synthetic so each row
 * shape is reproducible without a live session.
 */
function Seed({ children, detail = true }: { children: ReactNode; detail?: boolean }) {
  useEffect(() => {
    useAppStore.setState({ detailChatMode: detail })
    useChatStore.setState({
      activeProject: '/storybook/codex-shapes',
      projectSessions: {
        '/storybook/codex-shapes': {
          ...createDefaultProjectState(),
          _activeSessionId: 'story-session',
          _sessions: { 'story-session': { ...createDefaultPerSessionState(), status: 'idle', cwd: '/workspace' } },
        },
      },
    })
  }, [detail])
  return <>{children}</>
}

function turn(items: CodexThreadItem[], status: ChatMessageType['status'] = 'complete'): ChatMessageType {
  return {
    id: `turn-${status}`,
    role: 'assistant',
    status,
    providerId: 'acp',
    createdAt: new Date(Date.now() - 12_000).toISOString(),
    content: codexItemsToContent(items),
  }
}

const command = (id: string, cmd: string, actions: CodexCommandAction[], output: string, exitCode = 0): CodexThreadItem => ({
  id, type: 'command_execution', command: `/bin/zsh -lc '${cmd}'`, cwd: '/workspace', aggregatedOutput: output, exitCode, status: exitCode === 0 ? 'completed' : 'failed', commandActions: actions,
})

const FINISHED: CodexThreadItem[] = [
  { id: 'r1', type: 'reasoning', text: 'Look at the entry point first, then the tests.', startedAt: 1, endedAt: 4_000 },
  { id: 'm1', type: 'agent_message', text: 'I’ll read the project before changing anything.' },
  command('c1', 'cat README.md', [{ type: 'read', command: 'cat README.md', name: 'README.md', path: '/workspace/README.md' }], '# Fixture\n'),
  command('c2', 'rg -n TODO src', [{ type: 'search', command: 'rg -n TODO src', query: 'TODO', path: 'src' }], 'src/app.ts:2: // TODO\n'),
  command('c3', 'ls src', [{ type: 'listFiles', command: 'ls src', path: 'src' }], 'app.ts\nutil.ts\n'),
  command('c4', 'bun test', [{ type: 'unknown', command: 'bun test' }], '1 fail\n', 1),
  { id: 'p1', type: 'file_change', status: 'completed', changes: [
    { path: '/workspace/src/app.ts', kind: 'update', diff: '@@ -1,3 +1,3 @@\n-  return `Hello`\n+  return `Hello, world`\n' },
    { path: '/workspace/notes.md', kind: 'add', diff: '- first\n- second\n' },
  ] },
  { id: 'p2', type: 'file_change', status: 'failed', changes: [] },
  { id: 'mcp1', type: 'mcp_tool_call', server: 'linear', tool: 'list_issues', arguments: { team: 'core' }, status: 'failed', authRequired: true, error: { message: 'MCP authentication required' } },
  { id: 'w1', type: 'web_search', query: 'bun latest release', status: 'completed' },
  { id: 'rv1', type: 'review', phase: 'entered', text: 'uncommitted changes' },
  { id: 'e1', type: 'error', message: 'Codex requires strict safety review for this turn.' },
  { id: 'rv2', type: 'review', phase: 'exited', text: 'No blocking findings.' },
  { id: 'k1', type: 'compaction' },
  { id: 'todo', type: 'todo_list', items: [{ text: 'Read', completed: true }, { text: 'Fix', completed: true }] },
  { id: 's1', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], prompt: 'Count the lines of README.md',
    agentsStates: { child: { status: 'completed', nickname: 'Ada', role: 'explorer', message: 'README.md has 4 lines.' } },
    childItems: { child: [command('cc1', 'wc -l README.md', [{ type: 'unknown', command: 'wc -l README.md' }], '4 README.md\n')] } },
  { id: 'wait1', type: 'collab_tool_call', tool: 'wait', status: 'completed', receiverThreadIds: ['child'], agentsStates: {} },
  { id: 'plan1', type: 'plan', text: '1. Add `farewell()` to `src/app.ts`\n2. Cover it with a unit test' },
  { id: 'm2', type: 'agent_message', text: 'The greeting is fixed; one test still fails on purpose.' },
]

const RUNNING: CodexThreadItem[] = [
  { id: 'r1', type: 'reasoning', text: 'Building first.', startedAt: Date.now() - 3_000 },
  { id: 'c1', type: 'command_execution', command: "/bin/zsh -lc 'make'", cwd: '/workspace', aggregatedOutput: 'compiling app.ts\ncompiling util.ts\n', status: 'in_progress',
    commandActions: [{ type: 'unknown', command: 'make' }] },
  { id: 's1', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], prompt: 'Lint the project',
    agentsStates: { child: { status: 'running', nickname: 'Bo' } } },
  { id: 'wait1', type: 'collab_tool_call', tool: 'wait', status: 'in_progress', receiverThreadIds: ['child'], agentsStates: {} },
  { id: 'plan1', type: 'plan', text: '1. Build\n2. Lint' },
]

const meta: Meta = {
  title: 'Chat/Turn Body/Codex Shapes',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** Every translated row shape in a finished turn, Detail Mode. */
export const Finished: Story = {
  render: () => (
    <Seed>
      <div className="@container mx-auto max-w-180">
        <ChatMessage message={turn(FINISHED)} sessionStatus="idle" isLastAssistant />
      </div>
    </Seed>
  ),
}

/** Running command with live output, a running agent card, a visible wait and a streaming plan. */
export const Streaming: Story = {
  render: () => (
    <Seed>
      <div className="@container mx-auto max-w-180">
        <ChatMessage message={turn(RUNNING, 'streaming')} sessionStatus="streaming" isLastAssistant />
      </div>
    </Seed>
  ),
}

/** Compact mode folds the process rows; the plan and replies stay pinned. */
export const CompactMode: Story = {
  render: () => (
    <Seed detail={false}>
      <div className="@container mx-auto max-w-180">
        <ChatMessage message={turn(FINISHED)} sessionStatus="idle" isLastAssistant />
      </div>
    </Seed>
  ),
}

/** Narrow pane: long commands and paths truncate inside their rows. */
export const Narrow: Story = {
  render: () => (
    <Seed>
      <div className="@container w-80">
        <ChatMessage message={turn(FINISHED)} sessionStatus="idle" isLastAssistant />
      </div>
    </Seed>
  ),
}
