import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { WorkflowBlock } from './WorkflowBlock'
import { useChatStore } from '@/stores/chat'
import type { ContentBlock } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const FAKE_AGENTS = [
  { agentId: 'a1', jsonlPath: '/tmp/x/agent-a1.jsonl', label: '用一句中文友好地打个招呼', toolCount: 0, resultText: '你好呀！' },
  { agentId: 'b2', jsonlPath: '/tmp/x/agent-b2.jsonl', label: '颜色 红色 → 十六进制', toolCount: 1, resultText: '#FF0000' },
  { agentId: 'c3', jsonlPath: '/tmp/x/agent-c3.jsonl', label: '颜色 绿色 → 十六进制', toolCount: 1, resultText: '#00FF00' },
  { agentId: 'd4', jsonlPath: '/tmp/x/agent-d4.jsonl', label: '颜色 蓝色 → 十六进制', toolCount: 1, resultText: '#0000FF' },
]

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
    durationMs?: number
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
              _sessions: { ...project._sessions, [sid]: { ...session, taskProgress } },
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

function makeToolBlock(toolUseId: string): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolName: 'Workflow',
    toolUseId,
    input: JSON.stringify({ script: SCRIPT }),
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
  title: 'ClaudeCode/WorkflowBlock',
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
        progress={{ completed: false, description: 'Fan-out: color:蓝色', lastToolName: 'color:蓝色', toolUses: 2, totalTokens: 39_498, durationMs: 4_579 }}
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
