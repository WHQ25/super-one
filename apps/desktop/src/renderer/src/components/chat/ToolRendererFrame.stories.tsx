import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolRendererFrame } from './ToolRendererFrame'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolRendererFrame> = {
  title: 'Common/ToolRendererFrame',
  component: ToolRendererFrame,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolRendererFrame>

export const InterceptPhase: Story = {
  args: {
    phase: 'intercept',
    state: {
      callId: 'call-int-1',
      appId: 'crm-tools',
      toolName: 'find_contact',
      toolUseId: 'tu-int-1',
      templateUrl: 'about:blank',
      agentInput: { query: 'alice@example.com' },
      status: 'awaiting',
    },
  },
}

export const ResultPhase: Story = {
  args: {
    phase: 'result',
    appId: 'expense-tracker',
    callId: 'call-res-1',
    toolName: 'add_expense',
    templatePath: 'templates/receipt-card.html',
    result: { merchant: 'Blue Bottle Coffee', amount: 7.5 },
    onClose: () => {},
  },
}
