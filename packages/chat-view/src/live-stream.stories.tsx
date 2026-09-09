import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

function LiveStream({ provider = 'claude', initialStage = 0, status = 'streaming', scheme = 'light' }: {
  provider?: 'claude' | 'codex'; initialStage?: number; status?: ChatMessage['status']; scheme?: 'light' | 'dark'
}) {
  const [stage, setStage] = useState(initialStage)
  const complete = stage === 3
  const source: ChatMessage = {
    id: 'live', role: 'assistant', providerId: provider, createdAt: new Date().toISOString(),
    status: complete ? 'complete' : status,
    content: provider === 'claude' ? [
      { type: 'thinking', thinking: 'Check the implementation before running the command. '.repeat(stage ? 30 : 1) },
      ...(stage >= 2 ? [{ type: 'tool_use' as const, toolUseId: 'command', toolName: 'Bash', input: '{"command":"pwd"}', status: complete ? 'complete' as const : 'streaming' as const }] : []),
      ...(complete ? [{ type: 'tool_result' as const, toolUseId: 'command', summary: '/project' }, { type: 'text' as const, text: 'The command has finished.' }] : []),
    ] : [],
    ...(provider === 'codex' ? { metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'reason', type: 'reasoning' as const, text: 'Check the implementation before running the command. '.repeat(stage ? 30 : 1) },
      ...(stage >= 2 ? [{ id: 'command', type: 'command_execution' as const, command: 'cat README.md', commandActions: [{ type: 'read' as const, name: 'README.md', path: 'README.md' }], aggregatedOutput: complete ? 'Project documentation' : '', status: complete ? 'completed' as const : 'in_progress' as const }] : []),
      ...(complete ? [{ id: 'answer', type: 'agent_message' as const, text: 'The command has finished.' }] : []),
    ] } } } : {}),
  }
  return <div className="mx-auto w-full max-w-[430px] space-y-4 p-4">
    <label className="flex flex-col gap-2 text-sm">
      Incoming state: {['Reasoning', 'More reasoning', 'Tool started', 'Completed'][stage]}
      <input aria-label="Incoming state" type="range" min={0} max={3} step={1} value={stage}
        onChange={(event) => setStage(Number(event.target.value))} />
    </label>
    <PortableMessage message={source} scheme={scheme} pendingPermission={null}
      isLastAssistant sessionStreaming={!complete && status === 'streaming'} />
  </div>
}

const meta = { title: 'Chat/Mobile live streaming', component: LiveStream,
  render: (args, context) => <LiveStream {...args} scheme={context.globals.theme ?? 'light'} />,
} satisfies Meta<typeof LiveStream>
export default meta
type Story = StoryObj<typeof meta>
export const Reasoning: Story = {}
export const LongReasoning: Story = { args: { initialStage: 1 } }
export const ToolStarted: Story = { args: { initialStage: 2 } }
export const CodexToolStarted: Story = { args: { provider: 'codex', initialStage: 2 } }
export const Completed: Story = { args: { initialStage: 3 } }
export const CodexCompleted: Story = { args: { provider: 'codex', initialStage: 3 } }
export const Interrupted: Story = { args: { status: 'interrupted' } }
export const Error: Story = { args: { status: 'error' } }
