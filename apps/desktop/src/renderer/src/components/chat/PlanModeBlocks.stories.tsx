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
  title: 'ClaudeCode/PlanModeBlocks',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const PLAN_TEXT = [
  '## Plan',
  '',
  '1. Audit existing usage of `Session.send()` to find direct callers.',
  '2. Add ownership guard inside `Session.send()` itself.',
  '3. Remove duplicated lock checks scattered through IPC handlers.',
  '4. Add integration test covering the locked-send rejection path.',
].join('\n')

export const EnterPlanModeBanner: Story = {
  args: {
    toolName: 'EnterPlanMode',
    input: '{}',
    status: 'complete',
  },
}

export const ExitPlanModePending: Story = {
  args: {
    toolName: 'ExitPlanMode',
    input: JSON.stringify({ plan: PLAN_TEXT }),
    status: 'complete',
  },
}

export const ExitPlanModeApproved: Story = {
  args: {
    toolName: 'ExitPlanMode',
    input: JSON.stringify({ plan: PLAN_TEXT }),
    status: 'complete',
    result: 'User approved the plan',
  },
}

export const ExitPlanModeRejected: Story = {
  args: {
    toolName: 'ExitPlanMode',
    input: JSON.stringify({ plan: PLAN_TEXT }),
    status: 'complete',
    result: '[denied] Step 3 needs more thought — please split the IPC cleanup into its own follow-up.',
  },
}

export const ExitPlanModeRejectedNoFeedback: Story = {
  args: {
    toolName: 'ExitPlanMode',
    input: JSON.stringify({ plan: PLAN_TEXT }),
    status: 'complete',
    result: '[denied] User rejected the plan',
  },
}
