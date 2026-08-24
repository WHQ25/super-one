import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { WorkflowFullView } from './WorkflowFullView'
import { WorkflowNavigationContext, type WorkflowViewState } from './workflow-navigation-context'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import type { WorkflowAgentInfo } from './use-workflow-agents'

const SCRIPT = `export const meta = {
  name: 'ui-test-minimal',
  description: '极简演示 workflow',
  phases: [
    { title: 'Greet', detail: '单个 agent 返回一句问候' },
    { title: 'Fan-out', detail: '三个并行 agent 各报一种颜色' },
  ],
}

phase('Greet')
const greeting = await agent('用一句中文友好地打个招呼', { label: 'greet' })

phase('Fan-out')
const colors = ['红色', '绿色', '蓝色']
const results = await parallel(colors.map((c) => () => agent(\`颜色 \${c}\`, { label: \`color:\${c}\` })))

return { greeting, colors: results }
`

const FAKE_AGENTS: WorkflowAgentInfo[] = [
  {
    agentId: 'a1f00d',
    jsonlPath: '/tmp/demo/subagents/workflows/wf_demo/agent-a1f00d.jsonl',
    label: '用一句中文友好地打个招呼，不超过15字。',
    prompt: '用一句中文友好地打个招呼，不超过15字。保持简洁、亲切。',
    toolCount: 0,
    resultText: '你好呀，很高兴见到你！👋',
  },
  {
    agentId: 'b2c0de',
    jsonlPath: '/tmp/demo/subagents/workflows/wf_demo/agent-b2c0de.jsonl',
    label: '你负责颜色 红色，返回它的十六进制。',
    toolCount: 1,
    resultText: '红色的十六进制是 **#FF0000**。',
  },
  {
    agentId: 'c3a11e',
    jsonlPath: '/tmp/demo/subagents/workflows/wf_demo/agent-c3a11e.jsonl',
    label: '你负责颜色 绿色，返回它的十六进制。',
    toolCount: 2,
    resultText: '绿色的十六进制是 **#00FF00**。',
  },
]

function StoryShell({ children }: { children: ReactNode }) {
  return <div className="h-[520px] w-full overflow-hidden rounded border border-border">{children}</div>
}

function FullViewHarness({ view }: { view: WorkflowViewState }) {
  const [current, setCurrent] = useState<WorkflowViewState | null>(view)
  const nav = {
    current,
    open: (s: WorkflowViewState) => setCurrent(s),
    close: () => setCurrent(view),
  }
  return (
    <WorkflowNavigationContext.Provider value={nav}>
      <StoryShell>{current && <WorkflowFullView view={current} />}</StoryShell>
    </WorkflowNavigationContext.Provider>
  )
}

const meta: Meta<typeof FullViewHarness> = {
  title: 'Tool UI/General/WorkflowFullView',
  component: FullViewHarness,
  parameters: { layout: 'padded' },
  decorators: [(Story) => { mockIpc('app', 'listWorkflowAgents', async () => FAKE_AGENTS); return <Story /> }],
}

export default meta
type Story = StoryObj<typeof FullViewHarness>

export const WithAgents: Story = {
  args: {
    view: { toolUseId: 'wf-full', transcriptDir: '/tmp/demo/subagents/workflows/wf_demo', name: 'ui-test-minimal', script: SCRIPT },
  },
}

export const Empty: Story = {
  args: {
    view: { toolUseId: 'wf-empty', transcriptDir: undefined, name: 'empty-workflow' },
  },
  decorators: [(Story) => { mockIpc('app', 'listWorkflowAgents', async () => []); return <Story /> }],
}
