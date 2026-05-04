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
  title: 'Chat/SetupMiniAppDevBlock',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const SETUP_INPUT = {
  name: 'palette-picker',
  directory: '/Users/me/projects/palette-picker',
  description: 'A small mini-app that picks colors from an image.',
}

export const Streaming: Story = {
  args: {
    toolName: 'mcp__superone__setup_mini_app_dev',
    input: JSON.stringify(SETUP_INPUT),
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const CompleteSuccess: Story = {
  args: {
    toolName: 'mcp__superone__setup_mini_app_dev',
    input: JSON.stringify(SETUP_INPUT),
    status: 'complete',
    result: JSON.stringify({
      status: 'ok',
      appId: 'palette-picker',
    }),
  },
}

export const CompleteError: Story = {
  args: {
    toolName: 'mcp__superone__setup_mini_app_dev',
    input: JSON.stringify(SETUP_INPUT),
    status: 'complete',
    result: JSON.stringify({
      status: 'error',
      message: 'Directory already contains a manifest.json — refusing to overwrite. Delete the existing app first or pick a different directory.',
    }),
  },
}
