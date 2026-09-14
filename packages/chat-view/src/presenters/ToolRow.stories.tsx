import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Globe, Video } from 'lucide-react'
import { ToolName, ToolRow, ToolSummary } from './ToolRow'

function Shell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const recording = (
  <Video className="size-3 text-muted-foreground/70" aria-label="Action recording" />
)

const meta = {
  title: 'Tool UI/General/ToolRow',
  component: ToolRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ToolRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Shell>
      <ToolRow icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}>
        <ToolName>Click</ToolName>
        <ToolSummary>Submit checkout</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const Expandable: Story = {
  render: () => (
    <Shell>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        expandable
        details={<div>click result</div>}
      >
        <ToolName>Click</ToolName>
        <ToolSummary>Submit checkout</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const RecordingIcon: Story = {
  name: 'recording icon sits with the chevron',
  render: () => (
    <Shell>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        expandable
        trailing={recording}
        details={<div>action recording</div>}
      >
        <ToolName>Click</ToolName>
        <ToolSummary>Verify the reply reappears after a missed update</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const RecordingIconNarrow: Story = {
  name: 'recording icon · narrow',
  render: () => (
    <Shell width={320}>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        expandable
        trailing={recording}
        details={<div>action recording</div>}
      >
        <ToolName>Click</ToolName>
        <ToolSummary>Verify the reply reappears after a missed update</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const TrailingWithoutExpand: Story = {
  name: 'trailing only, no chevron',
  render: () => (
    <Shell>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        trailing={recording}
      >
        <ToolName>Click</ToolName>
        <ToolSummary>Submit checkout</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const Error: Story = {
  render: () => (
    <Shell>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        tone="error"
        expandable
        trailing={recording}
        details={<div>element not found</div>}
      >
        <ToolName tone="error">Click</ToolName>
        <ToolSummary>Submit checkout</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const Denied: Story = {
  render: () => (
    <Shell>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        tone="denied"
        expandable
        details={<div>permission denied</div>}
      >
        <ToolName tone="denied">Click</ToolName>
        <ToolSummary>Submit checkout</ToolSummary>
      </ToolRow>
    </Shell>
  ),
}

export const LongSummary: Story = {
  render: () => (
    <Shell width={420}>
      <ToolRow
        icon={<Globe className="size-3 shrink-0 text-muted-foreground" />}
        expandable
        trailing={recording}
        details={<div>action recording</div>}
      >
        <ToolName>Click</ToolName>
        <ToolSummary>
          Click the primary submit button on the checkout page after the spinner
          clears and the total has finished updating
        </ToolSummary>
      </ToolRow>
    </Shell>
  ),
}
