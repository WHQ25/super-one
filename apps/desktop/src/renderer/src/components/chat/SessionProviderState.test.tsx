/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionProviderState as SharedState } from '@superone/chat-view/SessionProviderState'
import { SessionProviderState } from './SessionProviderState'

const mocks = vi.hoisted(() => ({ call: vi.fn(async () => ({ ok: true })), locked: false }))
const items = [{ id: 'input', text: 'next input', delivery: 'queue' as const, createdAt: 1, attachmentCount: 0 }]
vi.mock('@/stores/chat', () => ({
  useSessionScope: () => ({ projectPath: '/scoped', sessionId: 'scoped-session' }),
  useChatStore: (select: (state: { activeProject: string }) => unknown) => select({ activeProject: '/another' }),
  useActiveSession: (select: (state: { sessionInbox: typeof items; harnessConnection: null; _activeSessionId: string }) => unknown) => select({ sessionInbox: items, harnessConnection: null, _activeSessionId: 'another-session' }),
  useIsRemoteLocked: () => mocks.locked,
}))
vi.mock('@/lib/session-client', () => ({ callSession: mocks.call }))
vi.mock('@/hooks/use-environment-serves', () => ({ useEnvironmentServes: () => true }))
afterEach(() => { cleanup(); mocks.call.mockClear(); mocks.locked = false })

describe('session provider controls', () => {
  it('routes inbox actions to the scoped session rather than the active project', async () => {
    render(<SessionProviderState />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Steer at Next Safe Point' }))
    expect(mocks.call).toHaveBeenLastCalledWith('/scoped', 'scoped-session', 'session.inbox.update', { inboxId: 'input', delivery: 'steer' })
    await user.click(screen.getByRole('button', { name: 'Withdraw Pending Input' }))
    expect(mocks.call).toHaveBeenLastCalledWith('/scoped', 'scoped-session', 'session.inbox.cancel', { inboxId: 'input' })
  })
  it('retains pending input and permits a retry after a concrete action error', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('stale input')).mockResolvedValueOnce(undefined)
    render(<SharedState items={items} onAction={action} />)
    const user = userEvent.setup(), withdraw = screen.getByRole('button', { name: 'Withdraw Pending Input' })
    await user.click(withdraw)
    expect(screen.getByRole('alert')).toHaveTextContent('stale input')
    expect(screen.getByText('next input')).toBeInTheDocument()
    await user.click(withdraw)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(action).toHaveBeenCalledTimes(2)
  })
  it('disables mutations after control is taken by another endpoint', () => {
    mocks.locked = true; render(<SessionProviderState />)
    expect(screen.getByRole('button', { name: 'Withdraw Pending Input' })).toBeDisabled()
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('retries only observation while disconnected and blocks inbox mutations', async () => {
    const reconnect = vi.fn(async () => {})
    render(<SharedState items={items} connection={{ state: 'disconnected', attempt: 5 }} onAction={vi.fn()} onReconnect={reconnect} />)
    expect(screen.getByRole('button', { name: 'Withdraw Pending Input' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reconnect).toHaveBeenCalledOnce()
  })
  it('shows no card for an empty connected inbox', () => {
    const { container } = render(<SharedState onAction={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
