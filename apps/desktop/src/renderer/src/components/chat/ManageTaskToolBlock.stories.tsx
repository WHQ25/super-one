import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ManageTaskToolBlock } from './ManageTaskToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function block(
  params: Record<string, unknown>,
  result: string | undefined,
  options: {
    toolName?: string
    isStreaming?: boolean
    isError?: boolean
    isDenied?: boolean
  } = {},
) {
  return (
    <ToolBlock
      toolName={options.toolName ?? 'ManageTask'}
      input={JSON.stringify(params)}
      result={
        options.isDenied
          ? '[denied] User denied permission'
          : options.isStreaming
            ? undefined
            : result
      }
      status={options.isStreaming ? 'streaming' : 'complete'}
      isError={options.isError}
    />
  )
}

function compact(params: Record<string, unknown>, result: string | undefined) {
  return <ManageTaskToolBlock params={params} result={result} isStreaming={false} allowExpand={false} />
}

const RUNNING_LIST_TABLE = [
  '| Start Time | Task ID | Tool | Description |',
  '|---|---|---|---|',
  '| 2026-11-09T14:01:12+08:00 | 5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-51 | run_command | Dev server startup |',
  '| 2026-11-09T14:04:38+08:00 | 5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-80 | schedule | Poll build status |',
].join('\n')

const RUNNING_STATUS_OUTPUT = [
  'Task: 8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80',
  'Status: RUNNING',
  'Log: file:///Users/dev/.gemini/antigravity-cli/brain/8ade19b2-c248-4d06-ae1d-47d68ca614d3/.system_generated/tasks/task-80.log',
  'Log output:',
  '<truncated 60 lines>',
  'VITE v6.1.0 ready in 342 ms',
  '  ➜  Local:   http://localhost:5173/',
  '  ➜  Network: use --host to expose',
  '',
  'Last progress: 5s ago',
].join('\n')

const COMPLETED_STATUS_OUTPUT = [
  'Task: 8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-51',
  'Status: DONE',
  'Log output:',
  'Test Files  12 passed (12)',
  'Tests       94 passed (94)',
  '',
  'Last progress: 1s ago',
].join('\n')

const meta: Meta = {
  title: 'Tool UI/General/Manage Task',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const ListTasks: Story = {
  render: () => (
    <>
      {block({ action: 'list' }, RUNNING_LIST_TABLE)}
      {block({ action: 'list' }, 'No background tasks are currently running.')}
    </>
  ),
}

export const CheckStatus: Story = {
  render: () => (
    <>
      {block(
        { action: 'status', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
        RUNNING_STATUS_OUTPUT,
      )}
      {block(
        { action: 'status', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-51' },
        COMPLETED_STATUS_OUTPUT,
      )}
    </>
  ),
}

export const SendInputAndStop: Story = {
  render: () => (
    <>
      {block(
        {
          action: 'send_input',
          taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80',
          input: 'y\n',
        },
        'Input sent to task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80".',
      )}
      {block(
        {
          action: 'kill',
          taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65',
        },
        'Task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65" cancelled.',
      )}
    </>
  ),
}

export const LegacyPersistedTurns: Story = {
  render: () => (
    <>
      {block(
        { Action: 'status', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
        'done',
        { toolName: 'manage_task' },
      )}
      {block(
        { Action: 'kill', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65' },
        'done',
        { toolName: 'manage_task' },
      )}
      {block({ Action: 'list' }, 'done', { toolName: 'manage_task' })}
    </>
  ),
}

export const Streaming: Story = {
  render: () => (
    <>
      {block({ action: 'list' }, undefined, { isStreaming: true })}
      {block(
        { action: 'status', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
        undefined,
        { isStreaming: true },
      )}
      {block(
        { action: 'send_input', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80', input: 'rs\n' },
        undefined,
        { isStreaming: true },
      )}
      {block(
        { action: 'kill', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65' },
        undefined,
        { isStreaming: true },
      )}
    </>
  ),
}

export const DeniedAndError: Story = {
  render: () => (
    <>
      {block(
        { action: 'kill', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-4' },
        'Encountered error in step execution: cannot kill task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-4": task is not running (status: DONE)',
        { isError: true },
      )}
      {block(
        { action: 'kill', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
        undefined,
        { isDenied: true },
      )}
    </>
  ),
}

export const Nested: Story = {
  render: () => (
    <>
      {compact({ action: 'list' }, RUNNING_LIST_TABLE)}
      {compact(
        { action: 'status', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
        RUNNING_STATUS_OUTPUT,
      )}
      {compact(
        { action: 'kill', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65' },
        'Task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65" cancelled.',
      )}
    </>
  ),
}
