import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { CodexCommandBlock } from './codex-item-renderer'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof CodexCommandBlock> = {
  title: 'Codex/CodexCommandBlock',
  component: CodexCommandBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof CodexCommandBlock>

export const BashRunning: Story = {
  args: {
    item: {
      id: 'cmd-bash-1',
      type: 'command_execution',
      command: 'bun run typecheck:web',
      aggregatedOutput: '',
      status: 'in_progress',
    },
    isStreaming: true,
  },
}

export const BashComplete: Story = {
  args: {
    item: {
      id: 'cmd-bash-2',
      type: 'command_execution',
      command: 'bun run typecheck:web',
      aggregatedOutput: 'No errors found.\n',
      exitCode: 0,
      status: 'completed',
    },
    isStreaming: false,
  },
}

export const BashFailed: Story = {
  args: {
    item: {
      id: 'cmd-bash-3',
      type: 'command_execution',
      command: 'bun run test',
      aggregatedOutput: 'FAIL  src/main/session/session.test.ts\n  ✗ rejects local send when remotely owned\n    Expected error to be thrown but it was not.\n',
      exitCode: 1,
      status: 'failed',
    },
    isStreaming: false,
  },
}

export const ReadAction: Story = {
  args: {
    item: {
      id: 'cmd-read-1',
      type: 'command_execution',
      command: 'cat /Users/me/projects/super-one/src/main/session/session.ts',
      aggregatedOutput: '...220 lines of session.ts...',
      exitCode: 0,
      status: 'completed',
      commandActions: [{ type: 'read', path: '/Users/me/projects/super-one/src/main/session/session.ts' }],
    },
    isStreaming: false,
  },
}

export const SearchAction: Story = {
  args: {
    item: {
      id: 'cmd-grep-1',
      type: 'command_execution',
      command: 'rg "session\\.send" src',
      aggregatedOutput: 'src/main/ipc/agent-ipc.ts:142:    session.send(text)\nsrc/main/ipc/agent-ipc.ts:201:    session.send(text)\n',
      exitCode: 0,
      status: 'completed',
      commandActions: [{ type: 'search', query: 'session\\.send', path: 'src' }],
    },
    isStreaming: false,
  },
}
