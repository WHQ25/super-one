/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEnvironmentListCache } from '@/lib/environment-list'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { SuggestedTaskToolBlock } from './SuggestedTaskToolBlock'

vi.mock('@/harness-ui/controls', () => ({
  HARNESS_CONTROLS: new Proxy({}, {
    get: () => ({
      LaunchModelControl: ({ catalog, profile, onChange, onRefreshModels }: { catalog: string; profile?: { name: string }; onChange: (value: { model: string }) => void; onRefreshModels?: () => void }) => <><span>{catalog} · {profile?.name}</span><button onClick={() => onChange({ model: profile?.name ?? '' })}>Pick model</button>{onRefreshModels ? <button onClick={() => onRefreshModels()}>Refresh models</button> : null}</>,
    }),
  }),
}))
afterEach(() => {
  resetEnvironmentListCache()
  vi.restoreAllMocks()
})

function environment(
  callSession: (connection: string, session: string, method: string, input?: unknown) => unknown,
  listItems: () => Promise<unknown> = async () => [],
) {
  return { callSession, listItems, onStatusEvent: () => () => {} }
}
let taskId: string
beforeEach(() => { taskId = crypto.randomUUID() })

describe('suggested task execution environment', () => {
  it('restores the selected harness and model on the first render after a remount', async () => {
    const user = userEvent.setup()
    const profiles = ['claude', 'codex'].map(id => ({
      id, name: id, harnessId: id, apiProviders: [], models: [], efforts: [], defaultConfig: {},
    }))
    const options = { profiles, initial: { agentId: 'claude', settings: {} } }
    const callSession = vi.fn(async (_connection: string, _session: string, method: string) =>
      method === 'session.suggestedTaskLaunchOptions' ? options : { sessionId: 'new' })
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const card = (sessionId: string) => <SessionScopeProvider value={{ projectPath: '/repo', sessionId }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>
    const view = render(card('original'))
    await user.click(await view.findByRole('button', { name: 'Agent' }))
    await user.click(await view.findByRole('menuitemradio', { name: 'codex' }))
    await user.click(view.getByRole('button', { name: 'Pick model' }))
    view.unmount()

    const reopened = render(card('original'))
    expect(reopened.getByRole('button', { name: 'Agent' })).toHaveTextContent('codex')
    expect(callSession).toHaveBeenCalledTimes(1)
    fireEvent.click(reopened.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith('local', 'original', 'session.launchSuggestedTask', {
      taskId, choice: { agentId: 'codex', settings: { model: 'codex' } },
    }))

    reopened.rerender(card('other'))
    expect(await reopened.findByRole('button', { name: 'Agent' })).toHaveTextContent('claude')
    expect(callSession).toHaveBeenCalledWith('local', 'other', 'session.suggestedTaskLaunchOptions', { taskId })
  })

  it('joins an options request started before the card remounted', async () => {
    const options = { profiles: [], initial: { agentId: 'claude', settings: {} } }
    let finish!: (result: typeof options) => void
    const callSession = vi.fn(() => new Promise(resolve => { finish = resolve }))
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const card = <SessionScopeProvider value={{ projectPath: '/repo', sessionId: 'source' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>
    render(card).unmount()
    const reopened = render(card)
    expect(callSession).toHaveBeenCalledTimes(1)
    finish(options)
    await waitFor(() => expect(reopened.container.querySelector('.animate-spin')).toBeNull())
  })

  it('does not carry a previous host selection into a newly loading source environment', async () => {
    const options = { profiles: [{ id: 'claude-base', name: 'Host A model', harnessId: 'claude', defaultConfig: {}, apiProviders: [], models: [], efforts: [] }], initial: { agentId: 'claude-base', settings: {} } }
    const callSession = vi.fn((connection: string, _session: string, method: string) => {
      if (method === 'session.suggestedTaskLaunchOptions') return connection === 'A' ? Promise.resolve(options) : new Promise(() => {})
      return Promise.resolve({ sessionId: 'new' })
    })
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const card = (connection: string) => <SessionScopeProvider value={{ projectPath: `remote:${connection}:/repo`, sessionId: 'source' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>
    const view = render(card('A'))
    fireEvent.click(await view.findByRole('button', { name: 'Pick model' }))
    view.rerender(card('B'))
    expect(view.queryByRole('button', { name: 'Pick model' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith('B', 'source', 'session.launchSuggestedTask', { taskId, choice: undefined }))
  })

  it('shows source-host failures without falling back to the local desktop', async () => {
    const callSession = vi.fn(async (_connection: string, _session: string, _method: string, _input: unknown) => { throw new Error('Source host offline') })
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const view = render(<SessionScopeProvider value={{ projectPath: 'remote:offline-host:/repo', sessionId: 'source' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    await view.findByText('Source host offline')
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Source host offline'))
    expect(callSession.mock.calls.every(args => args[0] === 'offline-host')).toBe(true)
  })
  it.each(['local', 'node-A', 'desktop-B'])('reads and starts only on the card source %s', async connectionId => {
    const options = { profiles: [{ id: 'claude-base', name: 'Source agent', harnessId: 'claude', defaultConfig: {}, apiProviders: [], models: [], efforts: [] }], initial: { agentId: 'claude-base', settings: { permissionMode: 'default' } } }
    const callSession = vi.fn(async (_connection: string, _session: string, method: string) => method === 'session.suggestedTaskLaunchOptions' ? options : { sessionId: 'new' })
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const projectPath = connectionId === 'local' ? '/repo' : `remote:${connectionId}:/repo`
    const view = render(<SessionScopeProvider value={{ projectPath, sessionId: 'source-session' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up', tldr: 'A separate issue' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    await waitFor(() => expect(callSession).toHaveBeenCalledWith(connectionId, 'source-session', 'session.suggestedTaskLaunchOptions', { taskId }))
    await waitFor(() => expect(view.getByText(`${connectionId === 'local' ? 'local' : 'profile'} · Source agent`)).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith(connectionId, 'source-session', 'session.launchSuggestedTask', { taskId, choice: options.initial }))
  })

  it('refreshes a remote catalog without replacing the card, and leaves a local catalog to its own control', async () => {
    const options = { profiles: [{ id: 'claude-base', name: 'Source agent', harnessId: 'claude', defaultConfig: {}, apiProviders: [], models: [], efforts: [] }], initial: { agentId: 'claude-base', settings: {} } }
    const callSession = vi.fn(async (_connection: string, _session: string, method: string) => method === 'session.suggestedTaskLaunchOptions' ? options : { sessionId: 'new' })
    Object.defineProperty(window, 'environment', { configurable: true, value: environment(callSession) })
    const remote = render(<SessionScopeProvider value={{ projectPath: 'remote:node-A:/repo', sessionId: 'source-session' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    fireEvent.click(await remote.findByRole('button', { name: 'Refresh models' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith('node-A', 'source-session', 'session.suggestedTaskLaunchOptions', { taskId, force: true }))
    expect(remote.getByText('profile · Source agent')).toBeTruthy()
    remote.unmount()

    const local = render(<SessionScopeProvider value={{ projectPath: '/repo', sessionId: 'source-session' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    await local.findByText('local · Source agent')
    expect(local.queryByRole('button', { name: 'Refresh models' })).toBeNull()
  })

  it('drops a harness the remote node does not advertise, even when the served list includes it', async () => {
    const options = {
      profiles: [
        { id: 'claude-base', name: 'Claude', harnessId: 'claude', defaultConfig: {}, apiProviders: [], models: [], efforts: [] },
        { id: 'codex-base', name: 'Codex', harnessId: 'codex', defaultConfig: {}, apiProviders: [], models: [], efforts: [] },
      ],
      initial: { agentId: 'claude-base', settings: { model: 'opus' } },
    }
    const callSession = vi.fn(async (_connection: string, _session: string, method: string) => (
      method === 'session.suggestedTaskLaunchOptions' ? options : { sessionId: 'new' }
    ))
    Object.defineProperty(window, 'environment', {
      configurable: true,
      value: environment(callSession, async () => [{ connectionId: 'node-A', capabilities: { harnessIds: ['codex'] } }]),
    })
    const view = render(<SessionScopeProvider value={{ projectPath: 'remote:node-A:/repo', sessionId: 'source-session' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    await waitFor(() => expect(view.getByText('profile · Codex')).toBeTruthy())
    expect(view.queryByText('profile · Claude')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith('node-A', 'source-session', 'session.launchSuggestedTask', {
      taskId,
      choice: { agentId: 'codex-base', settings: {} },
    }))
  })
})
