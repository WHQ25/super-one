import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import type { SessionAgentProfile } from '@superone/shared/agent-types'
import type { SuggestedTaskLaunchChoice, SuggestedTaskState } from '@superone/shared/suggested-task'
import { SuggestedTaskCard } from '@superone/chat-view/presenters/SuggestedTaskCard'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { SuggestedTaskLaunchControls, type LaunchOptionsState } from './SuggestedTaskToolBlock'
import { renderToolMarkdown } from './tool-block-presenters/tool-markdown'
import { ToolBlock } from './ToolBlock'

/**
 * `session_suggest_task` card. Interactive
 * stories drive the production card with stub actions in place of the desktop
 * IPC, so launching needs no live session.
 */

const TASK_ID = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const PARAMS = {
  title: 'Fix the flaky login test',
  tldr: 'auth.spec.ts times out on CI about one run in five; the mock clock is never restored.',
  prompt: [
    '## Task',
    'Fix the flaky login test in `apps/web/e2e/auth.spec.ts`.',
    '',
    '## Context',
    '- It times out on CI about one run in five.',
    '- `vi.useFakeTimers()` is never paired with `vi.useRealTimers()`, so later tests inherit the frozen clock.',
    '',
    '## Done when',
    '1. The spec restores real timers in `afterEach`.',
    '2. `bunx playwright test auth.spec.ts --repeat-each 20` passes.',
  ].join('\n'),
}

const CLAUDE_PROFILE: SessionAgentProfile = {
  id: 'claude-base',
  name: 'Claude',
  harnessId: 'claude',
  defaultConfig: { model: 'claude-sonnet', effort: 'high' },
  models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }, { id: 'claude-opus', name: 'Claude Opus' }],
  efforts: ['low', 'medium', 'high'],
  apiProviders: [],
}

const CODEX_PROFILE: SessionAgentProfile = {
  id: 'codex-base',
  name: 'Codex',
  harnessId: 'codex',
  defaultConfig: { model: 'gpt-5.4-codex', effort: 'medium', fastMode: false },
  models: [{ id: 'gpt-5.4-codex', name: 'GPT-5.4 Codex' }, { id: 'gpt-5.4-codex-mini', name: 'GPT-5.4 Codex mini' }],
  efforts: ['low', 'medium', 'high'],
  apiProviders: [],
}

/** As main answers for a Claude session running Opus in plan mode. */
const READY: LaunchOptionsState = {
  status: 'ready',
  options: {
    profiles: [CLAUDE_PROFILE, CODEX_PROFILE],
    initial: { agentId: 'claude-base', settings: { model: 'claude-opus', effort: 'high', permissionMode: 'plan' } },
  },
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
function InteractiveCard({
  failLaunch = false,
  params = PARAMS,
  launchOptions = READY,
}: {
  failLaunch?: boolean
  params?: Record<string, unknown>
  launchOptions?: LaunchOptionsState
}) {
  const [state, setState] = useState<SuggestedTaskState>()
  const [choice, setChoice] = useState<SuggestedTaskLaunchChoice>()
  return (
    <SuggestedTaskCard
      params={params}
      state={state}
      onOpenSession={() => {}}
      renderMarkdown={renderToolMarkdown}
      launchControls={<SuggestedTaskLaunchControls state={launchOptions} choice={choice} onChange={setChoice} />}
      actions={{
        launch: async () => {
          await delay(600)
          if (failLaunch) return 'Branch task/fix-the-flaky-login-test-0b9f3c1e already exists.'
          setState({ status: 'launched', sessionId: 'session-2' })
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
  decorators: [(Story) => {
    for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'codexListModels']) {
      mockIpc('app', method, async () => [])
    }
    mockIpc('app', 'getMediaServerPort', async () => 6006)
    return <Story />
  }],
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

/** Clicking the summary opens the brief, rendered as Markdown, beneath it; clicking again closes it. */
export const PromptExpanded: Story = {
  render: () => <Shell><InteractiveCard /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = canvas.getByRole('button', { name: new RegExp(PARAMS.title) })
    await userEvent.click(canvas.getByText(PARAMS.tldr))
    await expect(await canvas.findByRole('heading', { name: 'Done when' })).toBeVisible()
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(summary)
    await expect(canvas.queryByRole('heading', { name: 'Done when' })).toBeNull()
    await userEvent.click(summary)
  },
}

export const PromptExpandedDark: Story = { ...PromptExpanded, globals: { theme: 'dark' } }

/** Another agent starts from its own model; switching back restores the session's settings. */
export const SwitchAgent: Story = {
  render: () => <Shell><InteractiveCard /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Agent' }))
    const selected = await page.findByRole('menuitemradio', { name: 'Claude' })
    await expect(selected).toHaveAttribute('aria-checked', 'true')
    await expect(selected.querySelector('.lucide-check')).toBeVisible()
    await expect(selected.lastElementChild).toHaveClass('lucide-check')
    await userEvent.click(await page.findByRole('menuitemradio', { name: 'Codex' }))
    await expect(await canvas.findByText(/GPT.?5\.4 Codex/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Agent' }))
    await expect(await page.findByRole('menuitemradio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(await page.findByRole('menuitemradio', { name: 'Claude' }))
    await expect(await canvas.findByText(/Opus/)).toBeVisible()
  },
}

export const SwitchAgentDark: Story = { ...SwitchAgent, globals: { theme: 'dark' } }

/** While main lists the agents, and when it cannot; Launch still runs on the session's own agent. */
export const LaunchOptionsStates: Story = {
  render: () => (
    <Shell>
      <InteractiveCard launchOptions={{ status: 'loading' }} />
      <InteractiveCard launchOptions={{ status: 'error', message: 'No agent can launch new sessions.' }} />
    </Shell>
  ),
}

export const PendingDark: Story = { ...Pending, play: undefined, globals: { theme: 'dark' } }

export const PendingChinese: Story = { ...PromptExpanded, play: undefined, globals: { locale: 'zh' } }

export const LaunchFails: Story = {
  render: () => <Shell><InteractiveCard failLaunch /></Shell>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Launch' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/already exists/)
    await expect(canvas.getByRole('button', { name: 'Launch' })).toBeEnabled()
  },
}

/** A launched card, and one a transcript stored as dismissed before cards lost Dismiss. */
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
      <SuggestedTaskCard params={PARAMS} renderMarkdown={renderToolMarkdown} />
      <SuggestedTaskCard params={PARAMS} renderMarkdown={renderToolMarkdown} unavailableReason="This session cannot launch tasks from here." />
    </Shell>
  ),
}

export const LongContent: Story = {
  render: () => <Shell><InteractiveCard params={LONG_PARAMS} /></Shell>,
}

/** A pane too narrow for every label: permission and sandbox fall back to their icons. */
export const NarrowLaunchBar: Story = {
  render: () => <Shell width={420}><InteractiveCard /></Shell>,
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
