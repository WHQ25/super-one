import type { Meta, StoryObj } from '@storybook/react-vite'
import { Terminal } from 'lucide-react'
import { ToolName, ToolRow, ToolSummary } from './tool-row'

const icon = <Terminal className="size-3 shrink-0 text-muted-foreground" />

const meta: Meta<typeof ToolRow> = {
  title: 'Tool UI/General/Row Primitive',
  component: ToolRow,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof ToolRow>

export const States: Story = {
  render: () => (
    <div className="w-[640px] space-y-2">
      <ToolRow icon={icon}>
        <ToolName>Command Run</ToolName>
        <ToolSummary>bun run typecheck:web</ToolSummary>
      </ToolRow>

      <ToolRow icon={icon}>
        <ToolName streaming>Running command…</ToolName>
        <ToolSummary>bun run test</ToolSummary>
      </ToolRow>

      <ToolRow icon={icon} tone="error">
        <ToolName tone="error">Run Command</ToolName>
        <ToolSummary>bun run test</ToolSummary>
      </ToolRow>

      <ToolRow icon={icon} tone="denied">
        <ToolName tone="denied">Run Command</ToolName>
        <ToolSummary>bun run release</ToolSummary>
      </ToolRow>

      <ToolRow
        icon={icon}
        expandable
        details={<pre className="whitespace-pre-wrap text-muted-foreground">No errors found.</pre>}
      >
        <ToolName>Command Run</ToolName>
        <ToolSummary>bun run typecheck:web</ToolSummary>
      </ToolRow>
    </div>
  ),
}
