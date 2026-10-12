import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import { NestedToolContext } from './nested-tool-context'

/**
 * Claude's coordination tools: moving the session between worktrees and messaging other
 * agents. Results are SDK 0.3.296 output captured from live calls (paths anonymized).
 */
function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/General/Coordination Tools',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const WORKTREE = '/Users/me/projects/super-one/.claude/worktrees/probe'

export const EnterWorktreeStreaming: Story = {
  args: { toolName: 'EnterWorktree', input: JSON.stringify({ name: 'probe' }), status: 'streaming', elapsedSeconds: 1 },
}

export const EnterWorktreeComplete: Story = {
  args: {
    toolName: 'EnterWorktree',
    input: JSON.stringify({ name: 'probe' }),
    status: 'complete',
    result: `Created worktree at ${WORKTREE} on branch worktree-probe. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
  },
}

export const EnterExistingWorktreeStreaming: Story = {
  args: {
    toolName: 'EnterWorktree',
    input: JSON.stringify({ path: WORKTREE }),
    status: 'streaming',
  },
}

export const EnterWorktreeError: Story = {
  args: {
    toolName: 'EnterWorktree',
    input: JSON.stringify({ name: 'probe' }),
    status: 'complete',
    result: 'WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)',
    isError: true,
  },
}

export const EnterWorktreeDenied: Story = {
  args: { toolName: 'EnterWorktree', input: JSON.stringify({ name: 'probe' }), status: 'complete', result: '[denied] User denied permission' },
}

export const ExitWorktreeKeep: Story = {
  args: {
    toolName: 'ExitWorktree',
    input: JSON.stringify({ action: 'keep' }),
    status: 'complete',
    result: `Exited worktree. Your work is preserved at ${WORKTREE} on branch worktree-probe. Session is now back in /Users/me/projects/super-one.`,
  },
}

export const ExitWorktreeRemoveStreaming: Story = {
  args: { toolName: 'ExitWorktree', input: JSON.stringify({ action: 'remove', discard_changes: true }), status: 'streaming', elapsedSeconds: 2 },
}

export const SendMessageComplete: Story = {
  args: {
    toolName: 'SendMessage',
    input: JSON.stringify({
      to: 'step3-e2e-transport',
      summary: 'Approve plan; run bun install, commit lock with deps',
      message: 'Go with packages/relay-client. After editing the package.json files, run `bun install` and commit the lockfile together with the dependency change.',
    }),
    status: 'complete',
    result: '{"success":true,"message":"Message queued for delivery to step3-e2e-transport at its next tool round.","pin":{"id":"a2c547f33bd6217e0","name":"step3-e2e-transport","ref":"77df75"}}',
  },
}

export const SendMessageStreaming: Story = {
  args: { toolName: 'SendMessage', input: JSON.stringify({ to: 'step4-remote-collab', message: 'Good work; the A-side' }), status: 'streaming' },
}

/** A phone's input is stripped: the summary comes from the host and the body from the receipt. */
export const SendMessageWithoutInput: Story = {
  args: {
    toolName: 'SendMessage',
    input: '{}',
    toolSummary: 'step4-remote-collab · Fix four open items before review',
    status: 'complete',
    result: '{"success":true,"message":"Resuming agent step4-remote-collab","resumedAgentId":"ab797b6dcb4952b5e","pin":{"id":"ab797b6dcb4952b5e","name":"step4-remote-collab","ref":"627e6e"}}',
  },
}

export const SendMessageProtocolReply: Story = {
  args: {
    toolName: 'SendMessage',
    input: JSON.stringify({ to: 'team-lead', message: { type: 'shutdown_response', request_id: 'req-1', approve: true } }),
    status: 'complete',
    result: '{"success":true,"message":"Message queued for delivery to team-lead at its next tool round."}',
  },
}

export const SendMessageNarrow: Story = {
  ...SendMessageComplete,
  decorators: [(Story) => <StoryShell width={320}><Story /></StoryShell>],
}

const HANDBACK_REPORT = "Here is how a session's cwd moves through SuperOne. There is no `cwd` column. A session's directory is derived from `worktree_path` (or the project path when that is null).\n\n## 1. Where cwd is stored\n- Desktop SQLite `sessions` table joins `projects.path`."

export const SubagentHandbackComplete: Story = {
  args: {
    toolName: 'SubagentHandback',
    input: JSON.stringify({ message: HANDBACK_REPORT }),
    status: 'complete',
    result: '{"success":true,"message":"Report delivered to your caller."}',
  },
}

/** Where it actually appears: inside the subagent's card, header-only. */
export const SubagentHandbackNested: Story = {
  ...SubagentHandbackComplete,
  decorators: [(Story) => (
    <StoryShell>
      <NestedToolContext.Provider value={{ allowExpand: false }}><Story /></NestedToolContext.Provider>
    </StoryShell>
  )],
}
