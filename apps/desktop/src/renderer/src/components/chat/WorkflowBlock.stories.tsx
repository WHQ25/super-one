import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { WorkflowBlock } from './WorkflowBlock'
import { SeedTaskProgress } from './workflow-story-fixtures'
import type { ContentBlock } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const FAKE_AGENTS = [
  { agentId: 'a1', jsonlPath: '/tmp/x/agent-a1.jsonl', label: 'greet', phase: 'Greet', state: 'completed', toolCount: 0, tokens: 12_480, resultText: '你好呀！' },
  { agentId: 'b2', jsonlPath: '/tmp/x/agent-b2.jsonl', label: 'color:红色', phase: 'Fan-out', state: 'completed', toolCount: 1, tokens: 14_210, resultText: '#FF0000' },
  { agentId: 'c3', jsonlPath: '/tmp/x/agent-c3.jsonl', label: 'color:绿色', phase: 'Fan-out', state: 'completed', toolCount: 1, tokens: 13_905, resultText: '#00FF00' },
  { agentId: 'd4', jsonlPath: '/tmp/x/agent-d4.jsonl', label: 'color:蓝色', phase: 'Fan-out', state: 'completed', toolCount: 1, tokens: 15_253, resultText: '#0000FF' },
]

const STATES = ['completed', 'completed', 'running', 'failed', 'completed', 'pending', 'running', 'stopped', 'completed']

/** A large run: three phases, mixed lifecycle states, real-sized token counts. */
const MANY_AGENTS = (['Review', 'Verify', 'Fix'] as const).flatMap((phase, p) =>
  Array.from({ length: [12, 20, 6][p] }, (_, i) => ({
    agentId: `${phase}-${i}`,
    jsonlPath: `/tmp/x/agent-${phase}-${i}.jsonl`,
    label: `${phase.toLowerCase()}:${['session-host.ts', 'node-host-controller.ts', 'rpc-client.ts', 'lease.ts'][i % 4]}:${40 + i * 7}`,
    phase,
    state: p === 0 ? (i === 5 ? 'failed' : 'completed') : p === 1 ? STATES[i % STATES.length] : undefined,
    toolCount: 6 + ((i * 13) % 40),
    tokens: 40_000 + ((i * 37_919) % 150_000),
  })).filter((agent) => p < 2 || agent.state !== undefined || agent.agentId === 'Fix-0'),
)

const NESTED_CHILD_PATH = '/tmp/demo/workflows/scripts/repro-harness.js'
const NESTED_CHILD = `export const meta = {
  name: 'repro-harness',
  description: '为高危发现构造最小复现',
  phases: [
    { title: 'Scout', detail: '定位入口与依赖' },
    { title: 'Repro', detail: '每条发现写一个复现' },
  ],
}
phase('Scout')
await agent('scout entry', { label: 'scout:entry' })
phase('Repro')
await parallel([1, 2, 3].map((i) => () => agent(\`repro \${i}\`, { label: \`repro:#\${i}\` })))
`
const NESTED_SCRIPT = `export const meta = {
  name: 'review-changes',
  description: 'Review changed files across dimensions, verify each finding',
  phases: [
    { title: 'Review', detail: '按维度审查改动' },
    { title: 'Verify', detail: '对抗验证每条发现，并为高危发现构造复现' },
    { title: 'Fix', detail: '在 worktree 中应用确认的修复' },
  ],
}
phase('Review')
await parallel(['bugs', 'perf', 'security'].map((d) => () => agent(\`review \${d}\`, { label: \`review:\${d}\` })))
phase('Verify')
await parallel(['f1', 'f2'].map((f) => () => agent(\`verify \${f}\`, { label: \`verify:\${f}\` })))
await workflow({ scriptPath: '${NESTED_CHILD_PATH}' })
phase('Fix')
await agent('fix all', { label: 'fix' })
`
function mockNestedRun(): void {
  mockIpc('app', 'listWorkflowAgents', async () => NESTED_AGENTS)
  mockIpc('app', 'readWorkflowScript', async (path: unknown) => (path === NESTED_CHILD_PATH ? NESTED_CHILD : null))
}
const nestedAgent = (agentId: string, prompt: string, label: string, phase: string, state: string, tokens: number) => (
  { agentId, jsonlPath: `/tmp/x/agent-${agentId}.jsonl`, prompt, label, phase, state, toolCount: Math.round(tokens / 4000), tokens }
)
const NESTED_AGENTS = [
  nestedAgent('r1', 'review bugs', 'review:bugs', 'Review', 'completed', 142_300),
  nestedAgent('r2', 'review perf', 'review:perf', 'Review', 'completed', 98_400),
  nestedAgent('r3', 'review security', 'review:security', 'Review', 'failed', 31_200),
  nestedAgent('v1', 'verify f1', 'verify:f1', 'Verify', 'completed', 51_200),
  nestedAgent('v2', 'verify f2', 'verify:f2', 'Verify', 'completed', 44_800),
  nestedAgent('s1', 'scout entry', 'scout:entry', 'Scout', 'completed', 52_100),
  nestedAgent('p1', 'repro 1', 'repro:#1', 'Repro', 'completed', 61_900),
  nestedAgent('p2', 'repro 2', 'repro:#2', 'Repro', 'running', 18_800),
  nestedAgent('p3', 'repro 3', 'repro:#3', 'Repro', 'running', 9_400),
]

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const SCRIPT = `export const meta = {
  name: 'ui-test-minimal',
  description: '极简演示 workflow，用于产生 workflow UI 展示数据',
  phases: [
    { title: 'Greet', detail: '单个 agent 返回一句问候' },
    { title: 'Fan-out', detail: '三个并行 agent 各报一种颜色' },
  ],
}

phase('Greet')
const greeting = await agent('用一句中文友好地打个招呼', { label: 'greet' })
`

function makeToolBlock(toolUseId: string, script = SCRIPT): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolName: 'Workflow',
    toolUseId,
    input: JSON.stringify({ script }),
    status: 'complete',
  } as ContentBlock & { type: 'tool_use' }
}

function makeResultBlock(toolUseId: string): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId,
    summary: [
      'Workflow launched in background. Task ID: wyk4kb95q',
      'Summary: 极简演示 workflow，用于产生 workflow UI 展示数据',
      'Transcript dir: /tmp/demo/subagents/workflows/wf_2f7264c8-4e0',
      'Script file: /tmp/demo/workflows/scripts/ui-test-minimal-wf_2f7264c8-4e0.js',
    ].join('\n'),
  } as ContentBlock
}

const meta: Meta<typeof WorkflowBlock> = {
  title: 'Tool UI/General/WorkflowBlock',
  component: WorkflowBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => { mockIpc('app', 'listWorkflowAgents', async () => FAKE_AGENTS); return <StoryShell><Story /></StoryShell> }],
}

export default meta
type Story = StoryObj<typeof WorkflowBlock>

export const Running: Story = {
  args: {
    toolBlock: makeToolBlock('wf-running'),
    resultBlock: makeResultBlock('wf-running'),
    isStreaming: true,
    defaultExpanded: true,
  },
  decorators: [(Story) => (
    <>
      <SeedTaskProgress
        toolUseId="wf-running"
        progress={{
          completed: false,
          description: 'Fan-out: color:蓝色',
          lastToolName: 'color:蓝色',
          toolUses: 2,
          totalTokens: 39_498,
          durationMs: 4_579,
          workflowAgents: [
            { agentId: 'a1', label: FAKE_AGENTS[0].label, toolCount: 0, state: 'completed', phase: 'Greet' },
            { agentId: 'b2', label: FAKE_AGENTS[1].label, toolCount: 1, state: 'failed', phase: 'Fan-out' },
            { agentId: 'c3', label: FAKE_AGENTS[2].label, toolCount: 1, state: 'running', phase: 'Fan-out' },
            { agentId: 'd4', label: FAKE_AGENTS[3].label, toolCount: 1, state: 'pending', phase: 'Fan-out' },
          ],
        }}
      />
      <Story />
    </>
  )],
}

export const Complete: Story = {
  args: {
    toolBlock: makeToolBlock('wf-complete'),
    resultBlock: makeResultBlock('wf-complete'),
    isStreaming: false,
    defaultExpanded: true,
  },
  decorators: [(Story) => (
    <>
      <SeedTaskProgress
        toolUseId="wf-complete"
        progress={{ completed: true, description: 'Fan-out: color:红色', toolUses: 3, totalTokens: 55_848, durationMs: 6_957 }}
      />
      <Story />
    </>
  )],
}

export const LaunchDenied: Story = {
  args: {
    toolBlock: {
      type: 'tool_use',
      toolName: 'Workflow',
      toolUseId: 'wf-denied',
      input: JSON.stringify({ source: { type: 'name', name: 'grok-build-parity' } }),
      status: 'complete',
    } as ContentBlock & { type: 'tool_use' },
    resultBlock: {
      type: 'tool_result',
      toolUseId: 'wf-denied',
      isError: true,
      summary: 'Tool `workflow` was not executed: Auto mode blocked this action',
    } as ContentBlock,
    isStreaming: false,
    defaultExpanded: true,
  },
}

export const Collapsed: Story = {
  args: {
    toolBlock: makeToolBlock('wf-collapsed'),
    resultBlock: makeResultBlock('wf-collapsed'),
    isStreaming: false,
    defaultExpanded: false,
  },
  decorators: [(Story) => (
    <>
      <SeedTaskProgress
        toolUseId="wf-collapsed"
        progress={{ completed: true, description: '', toolUses: 3, totalTokens: 55_848, durationMs: 6_957 }}
      />
      <Story />
    </>
  )],
}

/** Agents still `running` in the journal when the run was stopped render as stopped tiles. */
export const Stopped: Story = {
  args: {
    toolBlock: makeToolBlock('wf-stopped'),
    resultBlock: makeResultBlock('wf-stopped'),
    isStreaming: false,
    defaultExpanded: true,
  },
  decorators: [(Story) => {
    mockIpc('app', 'listWorkflowAgents', async () => FAKE_AGENTS.map((a, i) => (i < 2 ? a : { ...a, state: 'running' })))
    return (
      <>
        <SeedTaskProgress
          toolUseId="wf-stopped"
          progress={{ completed: true, status: 'stopped', description: '', toolUses: 3, totalTokens: 55_848, durationMs: 6_957 }}
        />
        <Story />
      </>
    )
  }],
}

/** 33 agents over three phases; tiles wrap instead of growing a scroll list. */
export const ManyAgents: Story = {
  args: {
    toolBlock: makeToolBlock('wf-many', NESTED_SCRIPT),
    resultBlock: makeResultBlock('wf-many'),
    isStreaming: true,
    defaultExpanded: true,
  },
  decorators: [(Story) => {
    mockIpc('app', 'listWorkflowAgents', async () => MANY_AGENTS)
    return (
      <>
        <SeedTaskProgress
          toolUseId="wf-many"
          progress={{ completed: false, description: 'Verify', toolUses: 412, totalTokens: 3_812_400, durationMs: 192_000 }}
        />
        <Story />
      </>
    )
  }],
}

/** A `workflow()` call nests the child's phases under the parent phase that called it. */
export const NestedWorkflow: Story = {
  args: {
    toolBlock: makeToolBlock('wf-nested', NESTED_SCRIPT),
    resultBlock: makeResultBlock('wf-nested'),
    isStreaming: true,
    defaultExpanded: true,
  },
  decorators: [(Story) => {
    mockNestedRun()
    return (
      <>
        <SeedTaskProgress
          toolUseId="wf-nested"
          progress={{ completed: false, description: 'Verify', toolUses: 120, totalTokens: 510_100, durationMs: 95_000 }}
        />
        <Story />
      </>
    )
  }],
}

export const Narrow: Story = {
  ...NestedWorkflow,
  args: { ...NestedWorkflow.args, toolBlock: makeToolBlock('wf-narrow', NESTED_SCRIPT), resultBlock: makeResultBlock('wf-narrow') },
  decorators: [
    (Story) => <StoryShell width={360}><Story /></StoryShell>,
    (Story) => {
      mockNestedRun()
      return (
        <>
          <SeedTaskProgress
            toolUseId="wf-narrow"
            progress={{ completed: false, description: 'Verify', toolUses: 120, totalTokens: 510_100, durationMs: 95_000 }}
          />
          <Story />
        </>
      )
    },
  ],
}
