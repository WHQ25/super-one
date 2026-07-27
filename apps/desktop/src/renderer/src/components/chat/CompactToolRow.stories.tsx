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

export const ManualReadWidgetStreaming: Story = {
  args: {
    toolName: 'mcp__superone__read_manual',
    input: JSON.stringify({ domain: 'widget', modules: ['diagram', 'chart'] }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const ManualReadWidgetComplete: Story = {
  args: {
    toolName: 'mcp__superone__read_manual',
    input: JSON.stringify({ domain: 'widget', modules: ['diagram'] }),
    status: 'complete',
    result: 'Loaded widget guidelines',
  },
}

export const ManualReadMiniappStreaming: Story = {
  args: {
    toolName: 'mcp__superone__read_manual',
    input: JSON.stringify({ domain: 'miniapp', topic: 'overview' }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const ManualReadMiniappComplete: Story = {
  args: {
    toolName: 'mcp__superone__read_manual',
    input: JSON.stringify({ domain: 'miniapp', topic: 'manifest' }),
    status: 'complete',
    result: 'Guide content delivered',
  },
}

export const PackMiniAppStreaming: Story = {
  args: {
    toolName: 'mcp__superone__miniapp_dev_pack',
    input: JSON.stringify({ appDir: '/Users/me/projects/example/dist', outputDir: '/Users/me/Downloads' }),
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const PackMiniAppComplete: Story = {
  args: {
    toolName: 'mcp__superone__miniapp_dev_pack',
    input: JSON.stringify({ appDir: '/Users/me/projects/example/dist', outputDir: '/Users/me/Downloads' }),
    status: 'complete',
    result: JSON.stringify({ packagePath: '/Users/me/Downloads/example-1.0.0.s1app' }),
  },
}

export const GenericUnknownMcpTool: Story = {
  args: {
    toolName: 'mcp__sentry__list_issues',
    input: JSON.stringify({ project: 'super-one', status: 'unresolved', limit: 10 }),
    status: 'complete',
    result: JSON.stringify({ issues: [{ id: 'PROJ-123', title: 'TypeError in ToolBlock' }] }),
  },
}
