import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorkflowDag } from './WorkflowDag'
import { parseWorkflowGraph } from './workflow-graph'
import { buildDag } from './workflow-dag'

const SCRIPT = `export const meta = { name: 'demo', description: '', phases: [] }
phase('Greet')
const g = await agent('hi', { label: 'greet' })
phase('Fan-out')
const colors = ['红色', '绿色', '蓝色']
await parallel(colors.map((c) => () => agent(\`颜色 \${c}\`, { label: \`color:\${c}\` })))
phase('Synthesize')
await agent('汇总', { label: 'synthesize' })
`

const PIPELINE_SCRIPT = `export const meta = { name: 'review', description: '', phases: [] }
phase('Review')
const dims = ['bugs', 'perf']
await pipeline(
  dims,
  (d) => agent('review ' + d, { label: 'review' }),
  (r) => agent('verify', { label: 'verify' }),
)
`

const graph = parseWorkflowGraph(SCRIPT)

const meta: Meta<typeof WorkflowDag> = {
  title: 'Tool UI/General/WorkflowDag',
  component: WorkflowDag,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof WorkflowDag>

export const Skeleton: Story = {
  args: { dag: buildDag(graph) },
}

export const RuntimeExpanded: Story = {
  args: {
    dag: buildDag(graph, [
      { label: 'color:红色', status: 'done', toolCount: 1 },
      { label: 'color:绿色', status: 'done', toolCount: 1 },
      { label: 'color:蓝色', status: 'running', toolCount: 2 },
    ]),
  },
}

export const Pipeline: Story = {
  args: { dag: buildDag(parseWorkflowGraph(PIPELINE_SCRIPT)) },
}
