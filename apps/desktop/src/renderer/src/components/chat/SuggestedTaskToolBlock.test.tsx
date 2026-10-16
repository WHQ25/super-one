/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { SuggestedTaskToolBlock } from './SuggestedTaskToolBlock'

vi.mock('@/harness-ui/controls', () => ({ HARNESS_CONTROLS: { claude: { LaunchModelControl: ({ catalog, profile, onChange }: { catalog: string; profile: { name: string }; onChange: (value: { model: string }) => void }) => <><span>{catalog} · {profile.name}</span><button onClick={() => onChange({ model: profile.name })}>Pick model</button></> } } }))
afterEach(() => vi.restoreAllMocks())
const taskId = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'

describe('suggested task execution environment', () => {
  it('does not carry a previous host selection into a newly loading source environment', async () => {
    const options = { profiles: [{ id: 'claude-base', name: 'Host A model', harnessId: 'claude', defaultConfig: {}, apiProviders: [], models: [], efforts: [] }], initial: { agentId: 'claude-base', settings: {} } }
    const callSession = vi.fn((connection: string, _session: string, method: string) => {
      if (method === 'session.suggestedTaskLaunchOptions') return connection === 'A' ? Promise.resolve(options) : new Promise(() => {})
      return Promise.resolve({ sessionId: 'new' })
    })
    Object.defineProperty(window, 'environment', { configurable: true, value: { callSession } })
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
    Object.defineProperty(window, 'environment', { configurable: true, value: { callSession } })
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
    Object.defineProperty(window, 'environment', { configurable: true, value: { callSession } })
    const projectPath = connectionId === 'local' ? '/repo' : `remote:${connectionId}:/repo`
    const view = render(<SessionScopeProvider value={{ projectPath, sessionId: 'source-session' }}>
      <SuggestedTaskToolBlock params={{ title: 'Follow up', tldr: 'A separate issue' }} result={JSON.stringify({ taskId })} />
    </SessionScopeProvider>)
    await waitFor(() => expect(callSession).toHaveBeenCalledWith(connectionId, 'source-session', 'session.suggestedTaskLaunchOptions', { taskId }))
    await waitFor(() => expect(view.getByText(`${connectionId === 'local' ? 'local' : 'profile'} · Source agent`)).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(callSession).toHaveBeenCalledWith(connectionId, 'source-session', 'session.launchSuggestedTask', { taskId, choice: options.initial }))
  })
})
