import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Common/CompactToolRow',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const GenericUnknownMcpTool: Story = {
  args: {
    toolName: 'mcp__sentry__list_issues',
    input: JSON.stringify({ project: 'super-one', status: 'unresolved', limit: 10 }),
    status: 'complete',
    result: JSON.stringify({ issues: [{ id: 'PROJ-123', title: 'TypeError in ToolBlock' }] }),
  },
}

export const GenericUnknownMcpToolStreaming: Story = {
  args: {
    toolName: 'mcp__sentry__list_issues',
    input: JSON.stringify({ project: 'super-one', status: 'unresolved', limit: 10 }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}
