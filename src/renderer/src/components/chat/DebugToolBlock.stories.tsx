import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { DebugToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof DebugToolBlock> = {
  title: 'Chat/DebugToolBlock',
  component: DebugToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof DebugToolBlock>

export const Streaming: Story = {
  args: {
    toolName: 'TodoWrite',
    input: '{"merge":true,"todos":[{"content":"',
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const CompleteWithJson: Story = {
  args: {
    toolName: 'TodoWrite',
    input: JSON.stringify({
      merge: true,
      todos: [
        { content: 'Write storybook coverage', status: 'in_progress', taskId: 't1' },
        { content: 'Run typecheck', status: 'pending', taskId: 't2' },
      ],
    }),
    status: 'complete',
    result: 'Updated 2 todos',
  },
}

export const CompleteEmptyInput: Story = {
  args: {
    toolName: 'CustomUnknownTool',
    input: '',
    status: 'complete',
    result: 'noop',
  },
}

export const CompleteRawInput: Story = {
  args: {
    toolName: 'AnotherTool',
    input: 'this is not json — just a raw string payload from a custom MCP server',
    status: 'complete',
    result: 'output line one\noutput line two\nsecond chunk of output',
  },
}
