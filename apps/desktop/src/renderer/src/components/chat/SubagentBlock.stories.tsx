import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { SubagentBlock } from './SubagentBlock'
import { useChatStore } from '@/stores/chat'
import type { ContentBlock } from '@superone/shared/agent-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function SeedTaskProgress({
  toolUseId,
  progress,
}: {
  toolUseId: string
  progress: {
    completed: boolean
    description: string
    lastToolName?: string
    toolUses: number
    totalTokens: number
    outputFile?: string
    toolHistory?: Array<{ toolName: string; description: string }>
  } | null
}) {
  useEffect(() => {
    const apply = (): void => {
      useChatStore.setState((s) => {
        const projectId = s.activeProject
        if (!projectId) return s
        const project = s.projectSessions[projectId]
        if (!project) return s
        const sid = project._activeSessionId
        if (!sid) return s
        const session = project._sessions[sid]
        if (!session) return s
        const taskProgress = { ...session.taskProgress }
        if (progress) taskProgress[toolUseId] = progress as never
        else delete taskProgress[toolUseId]
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectId]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sid]: { ...session, taskProgress },
              },
            },
          },
        }
      })
    }
    apply()
    const t = setTimeout(apply, 0)
    return () => clearTimeout(t)
  }, [toolUseId, progress])
  return null
}

const TASK_PROMPT = [
  'Investigate why session.send() is being called from outside the lock check path.',
  '',
  'Specifically check src/main/session/session.ts and any IPC handlers that bypass the lock.',
  'Report findings with file:line references.',
].join('\n')

function makeTaskBlock(overrides: Partial<ContentBlock & { type: 'tool_use' }> = {}): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolName: 'Task',
    toolUseId: 'task-default',
    input: JSON.stringify({
      subagent_type: 'general-purpose',
      description: 'Audit session.send() callers',
      prompt: TASK_PROMPT,
    }),
    status: 'complete',
    elapsedSeconds: 42,
    ...overrides,
  } as ContentBlock & { type: 'tool_use' }
}

const meta: Meta<typeof SubagentBlock> = {
  title: 'Tool UI/General/SubagentBlock',
  component: SubagentBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof SubagentBlock>

export const Spawning: Story = {
  args: {
    taskBlock: {
      type: 'tool_use',
      toolName: 'Task',
      toolUseId: 'task-spawning',
      input: '{"subagent_type":"',
      status: 'streaming',
      elapsedSeconds: 1,
    } as ContentBlock & { type: 'tool_use' },
    childBlocks: [],
    isStreaming: true,
  },
}

export const Running: Story = {
  args: {
    taskBlock: makeTaskBlock({ toolUseId: 'task-running', status: 'streaming', elapsedSeconds: 18 }),
    childBlocks: [
      {
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'child-1',
        input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/session/session.ts' }),
        status: 'complete',
        parentToolUseId: 'task-running',
        elapsedSeconds: 1,
      },
      {
        type: 'tool_use',
        toolName: 'Grep',
        toolUseId: 'child-2',
        input: JSON.stringify({ pattern: 'session\\.send', glob: '**/*.ts' }),
        status: 'streaming',
        parentToolUseId: 'task-running',
        elapsedSeconds: 2,
      },
    ] as ContentBlock[],
    isStreaming: true,
    defaultExpanded: true,
  },
}

export const Complete: Story = {
  args: {
    taskBlock: makeTaskBlock({ toolUseId: 'task-complete' }),
    childBlocks: [
      {
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'c1',
        input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/session/session.ts' }),
        status: 'complete',
        parentToolUseId: 'task-complete',
      },
      {
        type: 'tool_result',
        toolUseId: 'c1',
        summary: 'Read 220 lines',
        parentToolUseId: 'task-complete',
      },
      {
        type: 'tool_use',
        toolName: 'Grep',
        toolUseId: 'c2',
        input: JSON.stringify({ pattern: 'session\\.send' }),
        status: 'complete',
        parentToolUseId: 'task-complete',
      },
      {
        type: 'tool_result',
        toolUseId: 'c2',
        summary: '3 matches in 2 files',
        parentToolUseId: 'task-complete',
      },
    ] as ContentBlock[],
    resultBlock: {
      type: 'tool_result',
      toolUseId: 'task-complete',
      summary: 'Found 3 callers of session.send():\n- src/main/ipc/agent-ipc.ts:142 (lock-checked)\n- src/main/ipc/agent-ipc.ts:201 (BYPASSES lock — likely the bug)\n- src/main/codex/codex-experiment-service.ts:78 (lock-checked)',
    } as ContentBlock,
    isStreaming: false,
    defaultExpanded: true,
  },
}

export const AsyncBackground: Story = {
  args: {
    taskBlock: makeTaskBlock({
      toolUseId: 'task-async',
      input: JSON.stringify({
        subagent_type: 'general-purpose',
        description: 'Long-running rebuild and rerun tests',
        prompt: 'Rebuild the SDK and rerun the integration suite.',
        run_in_background: true,
      }),
    }),
    childBlocks: [],
    isStreaming: false,
    defaultExpanded: true,
  },
  decorators: [(Story) => (
    <>
      <SeedTaskProgress
        toolUseId="task-async"
        progress={{
          completed: false,
          description: 'Running integration test suite (3/12)',
          lastToolName: 'Bash',
          toolUses: 8,
          totalTokens: 14_320,
          outputFile: '/tmp/subagent-task-async.jsonl',
        }}
      />
      <Story />
    </>
  )],
}

export const Collapsed: Story = {
  args: {
    taskBlock: makeTaskBlock({ toolUseId: 'task-collapsed' }),
    childBlocks: [],
    resultBlock: {
      type: 'tool_result',
      toolUseId: 'task-collapsed',
      summary: 'Task finished. See output above.',
    } as ContentBlock,
    isStreaming: false,
    defaultExpanded: false,
  },
}
