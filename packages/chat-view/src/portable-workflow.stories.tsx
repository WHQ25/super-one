import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { PortableMessage } from './PortableMessage'

/**
 * The workflow card on the phone, fed exactly what the desktop projects: a
 * collapsed shell (`input` stripped of the script) plus the fields the reducers
 * patch on as the run progresses. No `taskProgress` store and no run directory
 * exist here, so every state below is driven by the block alone. The desktop's
 * full-view button is the one thing deliberately absent.
 */
const WF = 'call-wf'

const RECEIPT = JSON.stringify({
  type: 'Workflow',
  run_id: 'wf_01a0a9',
  task_id: 'wf_01a0a9',
  name: 'grok-build-parity',
  script_path: '/Users/x/.grok/sessions/p/s/workflows/wf_01a0a9/script.rhai',
  message: "Workflow 'grok-build-parity' started in the background.",
})

const PHASES_RUNNING = [
  { title: 'Source', detail: 'ensure local grok-build checkout', state: 'done' },
  { title: 'Catalog', detail: 'one agent per capability family', state: 'active' },
  { title: 'Gap', detail: 'diff against SuperOne ACP host', state: 'pending' },
  { title: 'Plan', detail: 'write PR slices', state: 'pending' },
]

function agents(count: number, running: boolean) {
  return Array.from({ length: count }, (_, index) => ({
    agentId: `a-${index}`,
    label: index % 2 === 0 ? `cataloger:${['tools', 'mcp', 'skills', 'hooks', 'modes'][index % 5]}` : `verifier:${index}`,
    toolCount: 3 + (index % 7),
    tokens: 4_000 + index * 1_900,
    state: running && index >= count - 2 ? 'running' : index % 9 === 4 ? 'failed' : 'done',
  }))
}

function workflowTurn(shell: Partial<ContentBlock>, result?: ContentBlock, status: 'streaming' | 'complete' = 'complete'): ChatMessage {
  return {
    id: 'workflow-turn',
    role: 'assistant',
    providerId: 'acp',
    createdAt: '2026-09-16T07:00:00Z',
    status,
    content: [
      { type: 'text', text: '工作流在 SuperOne 仓库，当前工作区发现不了它。我会用绝对路径启动。' } as ContentBlock,
      {
        type: 'tool_use',
        toolName: 'Workflow',
        toolUseId: WF,
        input: JSON.stringify({ source: { type: 'name', name: 'grok-build-parity' } }),
        status: 'complete',
        ...shell,
      } as ContentBlock,
      ...(result ? [result] : []),
    ],
  } as ChatMessage
}

const RECEIPT_RESULT: ContentBlock = { type: 'tool_result', toolUseId: WF, summary: RECEIPT }

function WorkflowTurn({ message, width = 390, streaming = false }: { message: ChatMessage; width?: number; streaming?: boolean }) {
  return (
    <div className="p-4" style={{ width }}>
      <PortableMessage message={message} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={streaming} />
    </div>
  )
}

const meta = {
  title: 'Chat/Portable/Workflow',
  component: WorkflowTurn,
} satisfies Meta<typeof WorkflowTurn>

export default meta
type Story = StoryObj<typeof meta>

export const Spawning: Story = {
  name: 'Spawning · call streaming, no meta yet',
  args: {
    streaming: true,
    message: workflowTurn({ input: '', status: 'streaming' }, undefined, 'streaming'),
  },
}

export const DeclaredMeta: Story = {
  name: 'Launching · Claude script meta on the shell, receipt not in yet',
  args: {
    streaming: true,
    message: workflowTurn({
      input: '',
      status: 'streaming',
      workflowName: 'review-changes',
      workflowDescription: 'Review changed files across dimensions, verify each finding',
      workflowPhases: [{ title: 'Review', detail: 'one agent per dimension' }, { title: 'Verify', detail: 'adversarial check of each finding' }],
    }, undefined, 'streaming'),
  },
}

export const Running: Story = {
  name: 'Running · receipt landed, live phases and agents',
  args: {
    message: workflowTurn({
      taskDescription: 'grok-build-parity: gap SuperOne ACP host coverage against grok-build source',
      taskSummary: 'grok-build-parity: phase Catalog · 5 agents · 3 done',
      workflowCurrentPhase: 'Catalog',
      workflowPhases: PHASES_RUNNING,
      workflowAgents: agents(5, true),
      taskUsage: { totalTokens: 38_400, toolUses: 21, durationMs: 154_000 },
    }, RECEIPT_RESULT),
  },
}

export const Complete: Story = {
  name: 'Complete · result text in the Output panel, receipt hidden',
  args: {
    message: workflowTurn({
      taskStatus: 'completed',
      taskDescription: 'grok-build-parity: gap SuperOne ACP host coverage against grok-build source',
      taskSummary: 'Plan written to docs/design/parity-plan.md',
      taskResultText: JSON.stringify({ plan: 'docs/design/parity-plan.md', gaps: 14, slices: 5 }, null, 2),
      workflowPhases: PHASES_RUNNING.map((phase) => ({ ...phase, state: 'done' })),
      workflowAgents: agents(7, false),
      taskUsage: { totalTokens: 212_000, toolUses: 96, durationMs: 1_512_000 },
    }, RECEIPT_RESULT),
  },
}

export const Failed: Story = {
  name: 'Failed · run ended in error after two phases',
  args: {
    message: workflowTurn({
      taskStatus: 'failed',
      taskSummary: 'agent budget exhausted in phase Gap',
      workflowPhases: PHASES_RUNNING.map((phase, index) => ({ ...phase, state: index < 2 ? 'done' : index === 2 ? 'failed' : 'pending' })),
      workflowAgents: agents(9, false),
      taskUsage: { totalTokens: 96_000, toolUses: 40, durationMs: 610_000 },
    }, RECEIPT_RESULT),
  },
}

export const Stopped: Story = {
  name: 'Stopped · cancelled by the user',
  args: {
    message: workflowTurn({
      taskStatus: 'stopped',
      taskSummary: 'cancelled',
      workflowPhases: PHASES_RUNNING,
      workflowAgents: agents(3, false),
      taskUsage: { totalTokens: 12_000, toolUses: 6, durationMs: 48_000 },
    }, RECEIPT_RESULT),
  },
}

export const LaunchFailed: Story = {
  name: 'Launch failed · tool error before any run started',
  args: {
    message: workflowTurn(
      { input: JSON.stringify({ source: { type: 'script_path', script_path: '/x/.grok/workflows/grok-build-parity.rhai' } }) },
      { type: 'tool_result', toolUseId: WF, summary: 'Tool `workflow` failed: workflow path is not trusted: /x/.grok/workflows/grok-build-parity.rhai (outside the project, grok home, and session workflow runs)', isError: true },
    ),
  },
}

export const ManyAgentsNarrow: Story = {
  name: 'Long · thirty agents on a narrow phone, list capped',
  args: {
    width: 320,
    message: workflowTurn({
      taskDescription: 'grok-build-parity: gap SuperOne ACP host coverage against grok-build source, then write the integration plan',
      taskSummary: 'grok-build-parity: phase Gap · 30 agents · 26 done',
      workflowCurrentPhase: 'Gap',
      workflowPhases: PHASES_RUNNING.map((phase, index) => ({ ...phase, state: index < 2 ? 'done' : index === 2 ? 'active' : 'pending' })),
      workflowAgents: agents(30, true),
      taskUsage: { totalTokens: 1_240_000, toolUses: 388, durationMs: 2_400_000 },
    }, RECEIPT_RESULT),
  },
}
