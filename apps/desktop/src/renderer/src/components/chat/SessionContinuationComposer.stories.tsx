import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { plainTextToTiptapDoc } from './chat-input/plainTextToTiptapDoc'
import { SessionContinuationComposer, SessionHandoffPrompt } from './SessionContinuationComposer'
import { SessionContinuationBanner } from './SessionContinuationBanner'
import { useSessionContinuationOffer } from './session-continuation-offer'

const projectPath = '/storybook/long-session'
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString()

const finishedTurn: ChatMessage = {
  id: 'a1', role: 'assistant', status: 'complete', providerId: 'claude', createdAt: twoHoursAgo,
  content: [{ type: 'text', text: 'Refactor done.' }],
  metadata: {
    completedAt: twoHoursAgo,
    usage: { inputTokens: 12, outputTokens: 400, cacheReadInputTokens: 410_000, cacheCreationInputTokens: 2_000, cacheTtl: '1h' },
  },
}

/** A long Claude session whose 1h cache expired an hour ago, with an unsent draft. */
function LongSession({ sessionId, continuedIn = null }: { sessionId: string; continuedIn?: string | null }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousHint = useAppStore.getState().sessionContinuationHint
    const session = createDefaultPerSessionState()
    Object.assign(session, {
      sessionProvider: 'claude', preferredProvider: 'claude', status: 'idle', messages: [finishedTurn],
      contextTokens: 412_012, draftText: 'also update the docs', draftJson: plainTextToTiptapDoc('also update the docs'),
      _continuedIn: continuedIn,
    })
    useChatStore.setState({ activeProject: projectPath, projectSessions: {
      [projectPath]: { ...createDefaultProjectState(), _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
    } })
    useAppStore.setState({ sessionContinuationHint: { enabled: true, minContextTokens: 300_000 } })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ sessionContinuationHint: previousHint })
    }
  }, [sessionId, continuedIn])
  return ready ? <Slot sessionId={sessionId} /> : null
}

/** What the composer slot shows for the active session, and where Approve took it. */
function Slot({ sessionId }: { sessionId: string }) {
  const offer = useSessionContinuationOffer()
  const active = useChatStore(useShallow((state) => {
    const project = state.projectSessions[projectPath]
    const session = project?._activeSessionId ? project._sessions[project._activeSessionId] : undefined
    return { id: project?._activeSessionId, draft: session?.draftText ?? '', continuesFrom: session?.continuesFrom ?? null }
  }))
  return (
    <div style={{ width: 620, maxWidth: '100%' }}>
      <SessionContinuationBanner />
      {offer
        ? <SessionContinuationComposer offer={offer} />
        : <div data-testid="text-composer" className="mx-3 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">Text composer</div>}
      <dl className="mx-3 mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground" data-testid="active-session">
        <dt>Active session</dt><dd>{active.id === sessionId ? 'original' : 'new'}</dd>
        <dt>Composer</dt><dd>{active.draft || '—'}</dd>
        <dt>Continues</dt><dd>{active.continuesFrom ?? '—'}</dd>
      </dl>
    </div>
  )
}

const meta: Meta<typeof SessionHandoffPrompt> = {
  title: 'Chat/SessionContinuationComposer',
  component: SessionHandoffPrompt,
  args: { onApprove: fn(), onDismiss: fn() },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 620, maxWidth: '100%' }}><Story /></div>],
}
export default meta
type Story = StoryObj<typeof SessionHandoffPrompt>

export const Handoff: Story = {}
export const Dark: Story = { globals: { theme: 'dark' } }
export const Chinese: Story = { globals: { locale: 'zh' } }
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] }
export const ChineseNarrowDark: Story = {
  globals: { locale: 'zh', theme: 'dark' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}

/** Approve opens a new session holding the mention and the moved draft. */
export const ApproveHandoff: Story = {
  render: () => <LongSession sessionId="approve-handoff" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(canvas.getByTestId('active-session')).toHaveTextContent('new'))
    await expect(canvas.getByTestId('active-session')).toHaveTextContent(/Composer@\S.* also update the docs/)
    await expect(canvas.getByTestId('active-session')).toHaveTextContent('Continuesapprove-handoff')
  },
}

/** Dismiss returns the text composer until the cache expires again. */
export const DismissHandoff: Story = {
  render: () => <LongSession sessionId="dismiss-handoff" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Dismiss/ }))
    await waitFor(() => expect(canvas.queryByTestId('session-handoff-prompt')).toBeNull())
    await expect(canvas.getByTestId('text-composer')).toBeInTheDocument()
  },
}

/** The old session after its continuation was created: no offer, a row that opens the successor. */
export const AlreadyContinued: Story = { render: () => <LongSession sessionId="continued" continuedIn="next-session" /> }
