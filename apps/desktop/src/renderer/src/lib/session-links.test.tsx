/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopSessionLinkPorts, openSessionLink } from './session-links'

const m = vi.hoisted(() => ({ state: { activeProject: '/source', projectSessions: { '/source': { _activeSessionId: 'source' } } } as { activeProject: string; projectSessions: Record<string, { _activeSessionId: string }> }, target: vi.fn(), load: vi.fn(), switch: vi.fn(), mount: vi.fn(), focus: vi.fn(), hydrate: vi.fn(), toast: vi.fn(), settings: vi.fn(), navigate: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: m.toast } }))
vi.mock('i18next', () => ({ default: { t: () => 'Remote host is offline or reconnecting. Try again in a moment.' } }))
vi.mock('@/stores/chat', () => ({ useChatStore: { getState: () => ({ ...m.state, switchToSession: m.switch, mountSession: m.mount }) } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ setSettingsTab: m.settings, navigateTo: m.navigate }) } }))
vi.mock('@/stores/chat-store/session-scope', () => ({ useSessionScope: vi.fn() }))
vi.mock('@/components/mosaic/mosaic-store', () => ({ useMosaicStore: { getState: () => ({ mode: 'single', focusOrReplaceFocused: m.focus }) } }))
vi.mock('./remote-session-ops', () => ({ hydrateRemoteSessionWithCatalog: m.hydrate }))
const ref = { environmentId: 'node', sessionId: 'target' }
beforeEach(() => {
  vi.clearAllMocks()
  m.state.activeProject = '/source'
  m.state.projectSessions = { '/source': { _activeSessionId: 'source' } }
  m.target.mockResolvedValue({ ref, projectPath: '/target', connectionId: null })
  m.load.mockResolvedValue({})
  Object.assign(window, { environment: { sessionLinkTarget: m.target }, app: { loadSessionState: m.load } })
})
describe('desktop session link navigation', () => {
  it('shows actionable offline copy while preserving identity and permission failures', () => {
    desktopSessionLinkPorts.onError(new Error("Error invoking remote method 'environment:sessionLinkTarget': Error: health probe failed for loopback http://127.0.0.1:7789/health: fetch failed"))
    expect(m.toast).toHaveBeenLastCalledWith('Remote host is offline or reconnecting. Try again in a moment.')
    desktopSessionLinkPorts.onError(new Error('environment identity mismatch: expected node, got replacement'))
    expect(m.toast).toHaveBeenLastCalledWith('environment identity mismatch: expected node, got replacement')
    desktopSessionLinkPorts.onError(new Error('Permission denied'))
    expect(m.toast).toHaveBeenLastCalledWith('Permission denied')
    expect(m.navigate).not.toHaveBeenCalled()
  })
  it('shows the underlying IPC error while retaining unknown-host navigation', () => {
    desktopSessionLinkPorts.onError(new Error("Error invoking remote method 'environment:sessionLinkTarget': Error: Session is unavailable"))
    expect(m.toast).toHaveBeenLastCalledWith('Session is unavailable')
    expect(m.navigate).not.toHaveBeenCalled()
    desktopSessionLinkPorts.onError(new Error("Error invoking remote method 'environment:sessionLinkTarget': Error: Unknown session environment: missing"))
    expect(m.toast).toHaveBeenLastCalledWith('Unknown session environment: missing')
    expect(m.settings).toHaveBeenCalledWith('remote')
    expect(m.navigate).toHaveBeenCalledWith('settings')
  })
  it('keeps the source untouched when target restoration fails', async () => {
    m.load.mockResolvedValue(null)
    await expect(openSessionLink(ref)).rejects.toThrow('restored')
    expect(m.switch).not.toHaveBeenCalled()
    expect(m.focus).not.toHaveBeenCalled()
  })
  it('does not commit an old link after the user switches projects during preflight', async () => {
    m.load.mockImplementation(async () => { m.state.activeProject = '/manual'; return {} })
    await openSessionLink(ref)
    expect(m.switch).not.toHaveBeenCalled()
  })
  it('commits only the requested target after preflight and avoids reopening the current session', async () => {
    await openSessionLink(ref)
    expect(m.switch).toHaveBeenCalledWith('/target', 'target')
    expect(m.focus).toHaveBeenCalledWith('/target', 'target')
    m.target.mockResolvedValue({ ref: { environmentId: 'desktop', sessionId: 'source' }, projectPath: '/source', connectionId: null })
    m.load.mockClear(); m.switch.mockClear()
    await openSessionLink({ environmentId: 'desktop', sessionId: 'source' })
    expect(m.load).not.toHaveBeenCalled()
    expect(m.switch).not.toHaveBeenCalled()
  })
})
