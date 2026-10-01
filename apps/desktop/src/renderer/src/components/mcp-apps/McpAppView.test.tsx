/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppFrameProps } from './McpAppFrame'
import type { McpAppDesktopApi } from './desktop-executor'
const frame = vi.hoisted(() => ({ props: null as McpAppFrameProps | null }))
vi.mock('@/components/activity/activity-panel-api', () => ({ openMcpAppTab: vi.fn(), getDockApi: () => null }))
vi.mock('@/stores/chat', () => ({ useChatStore: (fn: (s: unknown) => unknown) => fn({ projectSessions: {} }), useSessionScope: () => null }))
vi.mock('@/hooks/useSlotBounds', () => ({ useSlotBounds: () => {} }))
vi.mock('@/hooks/use-is-dark', () => ({ useIsDark: () => false }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('./McpAppFrame', () => ({ default: (props: McpAppFrameProps) => { frame.props = props; return <div data-testid="frame" /> } }))
import McpAppView from './McpAppView'
const app: ToolAppAttachment = { appInstanceId: 'v', binding: { node: 'local', session: 'original', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result' }
const prepared = { state: 'ready', document: { id: 'doc', url: 'superone-mcp-app://origin/view', origin: 'superone-mcp-app://origin', appInstanceId: 'v' }, active: false, meta: {} } as const
function setup() {
  const api: McpAppDesktopApi = { mcpAppRegister: vi.fn<McpAppDesktopApi['mcpAppRegister']>(async () => ({ ok: true, value: prepared })), mcpAppRequest: vi.fn<McpAppDesktopApi['mcpAppRequest']>(async () => ({ ok: true, value: {} })), mcpAppCancel: vi.fn(async () => {}), mcpAppRelease: vi.fn(async () => {}), onMcpAppDocumentRevoked: () => () => {}, mcpAppsAuthenticate: vi.fn<McpAppDesktopApi['mcpAppsAuthenticate']>(async () => ({ ok: true, value: null })) }
  return { api, mount: () => render(<McpAppView app={app} route={{ projectPath: '/original-project', sessionId: 'original' }} api={api} />) }
}
afterEach(() => { cleanup(); frame.props = null })
describe('MCP App desktop View lifecycle', () => {
  it('paints restored snapshots without activating and reconnects only on explicit action', async () => {
    const s = setup(); const ui = s.mount(); await screen.findByTestId('frame')
    expect(s.api.mcpAppRequest).not.toHaveBeenCalled(); expect(frame.props?.active).toBe(false)
    fireEvent.click(screen.getByText('mcpApp.activate'))
    await waitFor(() => expect(frame.props?.active).toBe(true))
    expect(s.api.mcpAppRequest).toHaveBeenCalledWith('/original-project', 'original', { appInstanceId: 'v', operation: 'activate' })
    ui.unmount(); expect(s.api.mcpAppRelease).toHaveBeenCalledWith('doc')
  })
  it('requires activation before preparing a missing historical snapshot', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValueOnce({ ok: true, value: { state: 'inactive' } })
    s.mount(); await screen.findByText('mcpApp.restored'); expect(screen.queryByTestId('frame')).toBeNull()
    fireEvent.click(screen.getByText('mcpApp.activate')); await screen.findByTestId('frame')
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(2)
  })
  it('offers auth and retries preparation without replaying a failed mutation', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValueOnce({ ok: false, error: { code: 'auth_required', message: 'Sign in' } })
    s.mount(); fireEvent.click(await screen.findByText('mcpApp.authenticate')); await screen.findByTestId('frame')
    expect(s.api.mcpAppsAuthenticate).toHaveBeenCalledWith('local', { binding: app.binding, origin: app.origin })
    expect(vi.mocked(s.api.mcpAppRequest).mock.calls.map(call => call[2].operation)).toEqual(['activate'])
  })
  it('renders host consent as plain text, declines and shows unknown/revoked states', async () => {
    const s = setup(); s.mount(); await screen.findByTestId('frame')
    vi.mocked(s.api.mcpAppRequest).mockResolvedValue({ ok: false, error: { code: 'approval_required', challenge: 'c', prompt: { kind: 'callTool', server: 'fixture', tool: 'next', argsPreview: '<img src=x onerror=evil()>', rememberable: true } } })
    let call!: Promise<unknown>
    act(() => { call = frame.props!.executor.callTool({ tool: 'next', args: {} }, new AbortController().signal).catch(error => error) })
    await screen.findByText('<img src=x onerror=evil()>'); expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByText('mcpApp.deny')); expect(await call).toMatchObject({ code: 'denied' }); expect(s.api.mcpAppRequest).toHaveBeenCalledTimes(1)
    act(() => { frame.props!.onUnknown(); frame.props!.onRevoked() })
    expect(screen.getByText('mcpApp.unknown')).toBeTruthy(); fireEvent.click(screen.getByText('mcpApp.restart'))
    await waitFor(() => expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(2))
  })
  it('releases a late registration when its shell has already unmounted', async () => {
    const s = setup(); let finish!: (value: any) => void
    vi.mocked(s.api.mcpAppRegister).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    s.mount().unmount(); await act(async () => finish({ ok: true, value: prepared }))
    expect(s.api.mcpAppRelease).toHaveBeenCalledWith('doc')
  })
})
