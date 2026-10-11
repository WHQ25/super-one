import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import type { SuggestedTaskState } from '@superone/shared/suggested-task'
import { SuggestedTaskCard } from '@superone/chat-view/presenters/SuggestedTaskCard'
import { ToolBlock } from './ToolBlock'

/**
 * `session_suggest_task` card. Interactive
 * stories drive the production card with stub actions in place of the desktop
 * IPC, so launching and dismissing need no live session.
 */

const TASK_ID = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const PARAMS = {
  title: 'Fix the flaky login test',
  tldr: 'auth.spec.ts times out on CI about one run in five; the mock clock is never restored.',
  prompt: '## Task\nFix the flaky login test …',
}
const LONG_PARAMS = {
  title: 'Consolidate the three duplicated retry helpers into one util',
  tldr: 'packages/runtime, apps/cli and apps/desktop each carry a retry-with-backoff helper with slightly different jitter and '
    + 'cancellation semantics. One of them swallows AbortError, which hides cancelled turns as successes in the usage stats. '
    + 'Merge them into packages/shared and keep the strictest abort behaviour.',
  prompt: '…',
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function Shell({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return <div className="@container space-y-3" style={{ maxWidth: width }}>{children}</div>
}

/** Stands in for the host: a successful action patches the card's state as main would. */
function InteractiveCard({ failLaunch = false, params = PARAMS }: { failLaunch?: boolean; params?: Record<string, unknown> }) {
  const [state, setState] = useState<SuggestedTaskState>()
  return (
    <SuggestedTaskCard
      params={params}
      state={state}
      onOpenSession={() => {}}
      actions={{
        launch: async () => {
          await delay(600)
          if (failLaunch) return 'Branch task/fix-the-flaky-login-test-0b9f3c1e already exists.'
          setState({ status: 'launched', sessionId: 'session-2' })
        },
        dismiss: async () => {
          await delay(200)
          setState({ status: 'dismissed' })
        },
      }}
    />
  )
}

function suggestRow(opts: { status?: 'streaming' | 'complete'; result?: string; isError?: boolean } = {}) {
  return (
    <ToolBlock
      toolName="mcp__superone__session_suggest_task"
      input={JSON.stringify(PARAMS)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
    />
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Suggested Task',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Pending: Story = {
  render: () => <Shell><InteractiveCard /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Launch' }))
    await expect(await canvas.findByRole('button', { name: /Open Session/ })).toBeVisible()
  },
}

export const PendingDark: Story = { ...Pending, play: undefined, globals: { theme: 'dark' } }

export const PendingChinese: Story = { ...Pending, play: undefined, globals: { locale: 'zh' } }

export const LaunchFails: Story = {
  render: () => <Shell><InteractiveCard failLaunch /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Launch' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/already exists/)
    await expect(canvas.getByRole('button', { name: 'Launch' })).toBeEnabled()
  },
}

export const DismissByUser: Story = {
  render: () => <Shell><InteractiveCard /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(await canvas.findByText('Dismissed')).toBeVisible()
  },
}

export const Settled: Story = {
  render: () => (
    <Shell>
      <SuggestedTaskCard params={PARAMS} state={{ status: 'launched', sessionId: 'session-2' }} onOpenSession={() => {}} />
      <SuggestedTaskCard params={PARAMS} state={{ status: 'dismissed' }} />
    </Shell>
  ),
}

export const SettledDark: Story = { ...Settled, globals: { theme: 'dark' } }

/** Phone (no actions) and a desktop session this window does not control. */
export const Unavailable: Story = {
  render: () => (
    <Shell>
      <SuggestedTaskCard params={PARAMS} />
      <SuggestedTaskCard params={PARAMS} unavailableReason="This session cannot launch tasks from here." />
    </Shell>
  ),
}

export const LongContent: Story = {
  render: () => <Shell><InteractiveCard params={LONG_PARAMS} /></Shell>,
}

export const Narrow: Story = {
  render: () => (
    <Shell width={300}>
      <InteractiveCard params={LONG_PARAMS} />
      <SuggestedTaskCard params={LONG_PARAMS} state={{ status: 'dismissed' }} />
    </Shell>
  ),
}

/** Header-only rows: streaming, failed, denied, and nested in a subagent card. */
export const Rows: Story = {
  render: () => (
    <Shell>
      <SuggestedTaskCard params={{ title: 'Fix the flaky' }} isStreaming />
      <SuggestedTaskCard params={PARAMS} isError />
      <SuggestedTaskCard params={PARAMS} isDenied />
      <SuggestedTaskCard params={PARAMS} allowExpand={false} />
    </Shell>
  ),
}

export const RowsDark: Story = { ...Rows, globals: { theme: 'dark' } }

/** Routed through the production ToolBlock and the desktop adapter (its buttons call `window.agent`, unmocked here). */
export const InTranscript: Story = {
  render: () => (
    <Shell>
      {suggestRow({ status: 'streaming' })}
      {suggestRow({ result: JSON.stringify({ taskId: TASK_ID, status: 'pending' }) })}
      {suggestRow({ result: '[Error] title must be at most 60 characters.', isError: true })}
    </Shell>
  ),
}
