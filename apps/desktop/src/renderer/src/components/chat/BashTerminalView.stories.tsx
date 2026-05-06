import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'ClaudeCode/BashTerminalView',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const NORMAL_OUTPUT = [
  'src/main/index.ts',
  'src/main/session/session.ts',
  'src/main/session/session.test.ts',
  'src/renderer/src/components/chat/ToolBlock.tsx',
  '4 files matched',
].join('\n')

const ANSI_OUTPUT = [
  '\x1b[32m✓\x1b[0m typecheck:web (3.2s)',
  '\x1b[32m✓\x1b[0m typecheck:node (1.1s)',
  '\x1b[31m✗\x1b[0m test (12.4s)',
  '  \x1b[31m●\x1b[0m \x1b[1msession ownership > rejects local send when remotely owned\x1b[0m',
  '    Expected: \x1b[32m"SessionLockedError"\x1b[0m',
  '    Received: \x1b[31m"undefined"\x1b[0m',
].join('\n')

const LARGE_OUTPUT = Array.from({ length: 80 }, (_, i) =>
  `${String(i + 1).padStart(3, ' ')}: ./node_modules/${['react', 'react-dom', 'zustand', 'motion', 'i18next'][i % 5]}/dist/index.js → resolved`
).join('\n')

export const Streaming: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'bun run typecheck:web' }),
    status: 'streaming',
    elapsedSeconds: 4,
  },
}

export const CompleteNormal: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'find src -name "*.ts" | head -5' }),
    status: 'complete',
    result: NORMAL_OUTPUT,
  },
}

export const CompleteWithDescription: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({
      command: 'bun install --frozen-lockfile',
      description: 'Install dependencies',
    }),
    status: 'complete',
    result: 'Lockfile is up to date · 1247 packages installed',
  },
}

export const Denied: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'rm -rf /important/data' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}

export const TimedOut: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'sleep 60', timeout: 5000 }),
    status: 'complete',
    result: '',
    isTimedOut: true,
  },
}

export const BackgroundTask: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({
      command: 'bun run dev',
      run_in_background: true,
    }),
    status: 'complete',
    result: 'Started Vite server on port 5173 (running in background)',
    backgroundActivity: true,
  },
}

export const LargeOutput: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'find node_modules -name "index.js" | head -80' }),
    status: 'complete',
    result: LARGE_OUTPUT,
  },
}

export const AnsiColored: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'bun run check-all' }),
    status: 'complete',
    result: ANSI_OUTPUT,
    isError: true,
  },
}
