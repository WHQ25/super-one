import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ManageSubagentsToolBlock } from './ManageSubagentsToolBlock'
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
      toolName={options.toolName ?? 'ManageSubagents'}
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
  return <ManageSubagentsToolBlock params={params} result={result} isStreaming={false} allowExpand={false} />
}

const ACTIVE_SUBAGENTS_LIST = [
  'You have 3 active subagent(s):',
  JSON.stringify([
    {
      conversationId: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
      role: 'HarnessId Architecture Researcher',
      type: 'research',
      state: 'running',
      stateDetail: 'read_file · antigravity-protocol.ts',
      transcript: 'file:///Users/dev/.gemini/antigravity-cli/brain/c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d/.system_generated/logs/transcript.jsonl',
    },
    {
      conversationId: '92bc1f73-84fa-42e9-9157-83df2d2e33bc',
      role: 'Database Migration Verifier',
      type: 'self',
      state: 'waiting_for_input',
      stateDetail: 'run_command · bunx vitest run',
    },
    {
      conversationId: '41ae802d-512a-49f1-81a0-72ce9f0b11aa',
      role: 'Storybook Snapshot Reviewer',
      type: 'research',
      state: 'idle',
    },
  ]),
].join('\n')

const PEER_SUBAGENTS_LIST = [
  'You have 1 active peer subagent(s) (parent 87a2a00d-7e8c-4bd4-a4dc-8f185fc589b3):',
  JSON.stringify([
    {
      conversationId: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
      role: 'HarnessId Architecture Researcher',
      type: 'research',
      state: 'running',
      stateDetail: 'grep_search · manage_subagents',
    },
  ]),
].join('\n')

const EMPTY_SUBAGENTS_LIST = 'You have 0 active subagent(s):\n[]'

const KILLED_SINGLE_OUTPUT = [
  'Successfully killed 1 subagent(s) and their descendants.',
  'Killed roles: HarnessId Architecture Researcher',
].join('\n')

const KILLED_MULTI_OUTPUT = [
  'Successfully killed 2 subagent(s) and their descendants.',
  'Killed roles: HarnessId Architecture Researcher, Database Migration Verifier',
].join('\n')

const meta: Meta = {
  title: 'Tool UI/General/Manage Subagents',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const ListSubagents: Story = {
  render: () => (
    <>
      {block({ action: 'list' }, ACTIVE_SUBAGENTS_LIST)}
      {block({ action: 'list' }, EMPTY_SUBAGENTS_LIST)}
      {block({ action: 'list_peers' }, PEER_SUBAGENTS_LIST)}
    </>
  ),
}

export const StopSubagents: Story = {
  render: () => (
    <>
      {block(
        {
          action: 'kill',
          conversationIds: ['c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d'],
        },
        KILLED_SINGLE_OUTPUT,
      )}
      {block(
        {
          action: 'kill',
          conversationIds: [
            'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
            '92bc1f73-84fa-42e9-9157-83df2d2e33bc',
          ],
        },
        KILLED_MULTI_OUTPUT,
      )}
      {block({ action: 'kill_all' }, KILLED_SINGLE_OUTPUT)}
      {block({ action: 'kill_all' }, 'No active subagents to kill.')}
    </>
  ),
}

export const LegacyPersistedTurns: Story = {
  render: () => (
    <>
      {block({ Action: 'list' }, 'done', { toolName: 'manage_subagents' })}
      {block({ Action: 'kill_all' }, 'done', { toolName: 'manage_subagents' })}
      {block(
        { Action: 'kill', ConversationIds: ['c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d'] },
        'done',
        { toolName: 'manage_subagents' },
      )}
    </>
  ),
}

export const Streaming: Story = {
  render: () => (
    <>
      {block({ action: 'list' }, undefined, { isStreaming: true })}
      {block(
        { action: 'kill', conversationIds: ['c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d'] },
        undefined,
        { isStreaming: true },
      )}
      {block({ action: 'kill_all' }, undefined, { isStreaming: true })}
    </>
  ),
}

export const DeniedAndError: Story = {
  render: () => (
    <>
      {block(
        { action: 'kill', conversationIds: ['c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d'] },
        'Encountered error in step execution: subagent "c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d" not found or not allowed to be invoked',
        { isError: true },
      )}
      {block(
        { action: 'kill_all' },
        undefined,
        { isDenied: true },
      )}
    </>
  ),
}

export const Nested: Story = {
  render: () => (
    <>
      {compact({ action: 'list' }, ACTIVE_SUBAGENTS_LIST)}
      {compact({ action: 'list' }, EMPTY_SUBAGENTS_LIST)}
      {compact({ action: 'kill_all' }, KILLED_SINGLE_OUTPUT)}
    </>
  ),
}
