import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { CompactIndicator } from './ChatMessage'

function InteractiveCompactIndicator({
  trigger,
  width = 760,
}: {
  trigger: 'auto' | 'manual'
  width?: number
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ maxWidth: width }}>
      <CompactIndicator
        trigger={trigger}
        preTokens={231_900}
        durationMs={105_000}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/CompactIndicator',
  component: CompactIndicator,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CompactIndicator>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { trigger: 'auto', preTokens: 231_900 },
  render: () => <InteractiveCompactIndicator trigger="auto" />,
}

export const Narrow: Story = {
  args: { trigger: 'auto', preTokens: 231_900 },
  render: () => <InteractiveCompactIndicator trigger="auto" width={380} />,
}

export const Tight: Story = {
  args: { trigger: 'auto', preTokens: 231_900 },
  render: () => <InteractiveCompactIndicator trigger="auto" width={280} />,
}

export const Manual: Story = {
  args: { trigger: 'manual', preTokens: 231_900 },
  render: () => <InteractiveCompactIndicator trigger="manual" />,
}
