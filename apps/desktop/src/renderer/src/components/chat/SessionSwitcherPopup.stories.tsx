import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionSwitcherView, type SwitcherRow } from './SessionSwitcherPopup'

const NOW = Date.now()

function row(overrides: Partial<SwitcherRow> & { sessionId: string; title: string }): SwitcherRow {
  return {
    status: 'idle',
    lastEventAt: NOW,
    isCurrent: false,
    isUnseen: false,
    isRemote: false,
    isAutomation: false,
    isWorktree: false,
    pendingReason: null,
    ...overrides,
  }
}

const meta: Meta<typeof SessionSwitcherView> = {
  title: 'Chat/SessionSwitcher',
  component: SessionSwitcherView,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof SessionSwitcherView>

export const SingleBackgroundFromIdleCurrent: Story = {
  name: 'Single — switching back to background work',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Refactor session-state-utils into a shared helper', status: 'background' }),
    ],
  },
}

export const Streaming: Story = {
  name: 'Streaming row (fresh activity)',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Implement Ctrl+Tab session switcher popup', status: 'streaming', lastEventAt: NOW }),
      row({ sessionId: 's2', title: 'Old chat about deployment workflow', status: 'idle', isCurrent: true }),
    ],
  },
}

export const StalledStreaming: Story = {
  name: 'Streaming row (stalled — old lastEventAt)',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Long-running task that has been silent', status: 'streaming', lastEventAt: NOW - 60_000 }),
    ],
  },
}

export const PendingPermission: Story = {
  name: 'Pending — Allow Bash',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Deploy script', status: 'idle', pendingReason: 'Allow Bash?' }),
    ],
  },
}

export const PendingPlan: Story = {
  name: 'Pending — Review plan',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Architecture refactor of auth module', status: 'idle', pendingReason: 'Review plan' }),
    ],
  },
}

export const TaskDoneUnseen: Story = {
  name: 'Task done (unseen check)',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Run full test suite', status: 'idle', isUnseen: true }),
    ],
  },
}

export const Worktree: Story = {
  name: 'Worktree session',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Spike: try motion library v12', status: 'background', isWorktree: true }),
    ],
  },
}

export const Remote: Story = {
  name: 'Remote (driven from mobile)',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({ sessionId: 's1', title: 'Quick fix from phone', status: 'background', isRemote: true }),
    ],
  },
}

export const LongTitle: Story = {
  name: 'Very long title (truncates)',
  args: {
    isOpen: true,
    selectedIndex: 0,
    rows: [
      row({
        sessionId: 's1',
        title: 'Investigate why the assistant occasionally drops the system prompt when resuming a session that was parked while another remote subscriber was attached',
        status: 'background',
      }),
    ],
  },
}

export const ManyMixed: Story = {
  name: 'Many mixed states',
  args: {
    isOpen: true,
    selectedIndex: 1,
    rows: [
      row({ sessionId: 's0', title: 'Old session (current)', status: 'idle', isCurrent: true }),
      row({ sessionId: 's1', title: 'Build the Ctrl+Tab popup', status: 'streaming', lastEventAt: NOW }),
      row({ sessionId: 's2', title: 'Permission needed for git push', status: 'idle', pendingReason: 'Allow Bash?' }),
      row({ sessionId: 's3', title: 'Plan approval pending', status: 'idle', pendingReason: 'Review plan' }),
      row({ sessionId: 's4', title: 'Run release script', status: 'idle', isUnseen: true }),
      row({ sessionId: 's5', title: 'Try a refactor on a worktree', status: 'background', isWorktree: true }),
      row({ sessionId: 's6', title: 'Mobile fix', status: 'background', isRemote: true }),
      row({ sessionId: 's7', title: 'Question is waiting for input', status: 'idle', pendingReason: 'Which file should I edit first?' }),
    ],
  },
}

export const ScrolledList: Story = {
  name: 'Scrolling list (15 rows)',
  args: {
    isOpen: true,
    selectedIndex: 7,
    rows: Array.from({ length: 15 }, (_, i) =>
      row({
        sessionId: `s${i}`,
        title: `Active session #${i + 1}`,
        status: i % 3 === 0 ? 'streaming' : i % 3 === 1 ? 'background' : 'idle',
        isCurrent: i === 0,
        isUnseen: i === 4,
        pendingReason: i === 9 ? 'Allow Write?' : null,
        lastEventAt: NOW - i * 1000,
      }),
    ),
  },
}

export const Closed: Story = {
  name: 'Closed (renders nothing)',
  args: {
    isOpen: false,
    selectedIndex: 0,
    rows: [],
  },
}
