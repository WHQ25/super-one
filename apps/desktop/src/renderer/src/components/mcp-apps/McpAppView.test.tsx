/** @vitest-environment jsdom */
import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppFrameProps } from './McpAppFrame'
import type { McpAppDesktopApi } from './desktop-executor'
const frame = vi.hoisted(() => ({ props: null as McpAppFrameProps | null, initialized: [] as McpAppFrameProps[], modes: ['inline', 'fullscreen', 'pip'] as Array<'inline' | 'fullscreen' | 'pip'> }))
const panel = vi.hoisted(() => ({ openMcpAppTab: vi.fn(), closeMcpAppTab: vi.fn() }))
vi.mock('@/components/activity/activity-panel-api', () => panel)
vi.mock('@/stores/chat', () => ({ useChatStore: (fn: (s: unknown) => unknown) => fn({ projectSessions: {} }), useSessionScope: () => null }))
vi.mock('@/hooks/use-is-dark', () => ({ useIsDark: () => false }))
// Lifecycle tests exercise preparation/activation/consent, independent of the
// window chrome; browser and native tests cover those surfaces.
vi.mock('./McpAppPip', () => ({ McpAppPip: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('./McpAppFrame', () => ({ default: (props: McpAppFrameProps) => { frame.props = props; useEffect(() => { frame.initialized.push(props); props.onInitialized(frame.modes) }, []); return <div data-testid="frame" /> } }))
import McpAppView from './McpAppView'
import { McpAppHostLayer } from './McpAppHostLayer'
import { McpAppConsentComposer } from './McpAppConsent'
import { useMcpAppLayout } from './layout-store'
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 240 } as DOMRect)
Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value() {
  for (let element: HTMLElement | null = this; element; element = element.parentElement) if (element.hidden || element.style.display === 'none') return false
  return true
} })
const app: ToolAppAttachment = { appInstanceId: 'v', binding: { node: 'local', session: 'original', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result' }
const prepared = { state: 'ready', document: { id: 'doc', url: 'superone-mcp-app://origin/view', origin: 'superone-mcp-app://origin', appInstanceId: 'v' }, active: false, meta: {} } as const
function setup() {
  const api: McpAppDesktopApi = { mcpAppRegister: vi.fn<McpAppDesktopApi['mcpAppRegister']>(async () => ({ ok: true, value: prepared })), mcpAppRequest: vi.fn<McpAppDesktopApi['mcpAppRequest']>(async () => ({ ok: true, value: {} })), mcpAppCancel: vi.fn(async () => {}), mcpAppRelease: vi.fn(async () => {}), onMcpAppDocumentRevoked: () => () => {}, mcpAppsAuthenticate: vi.fn<McpAppDesktopApi['mcpAppsAuthenticate']>(async () => ({ ok: true, value: null })) }
  return { api, mount: () => render(<><McpAppHostLayer /><McpAppView app={app} route={{ projectPath: '/original-project', sessionId: 'original' }} api={api} /><McpAppConsentComposer sessionId="original" /></>) }
}
afterEach(() => { cleanup(); frame.props = null; frame.initialized = []; frame.modes = ['inline', 'fullscreen', 'pip']; vi.clearAllMocks() })
describe('MCP App desktop View lifecycle', () => {
  it('renders safe tool metadata and keeps fullscreen preference inline on initialize', async () => {
    const s = setup()
    vi.mocked(s.api.mcpAppRegister).mockResolvedValue({ ok: true, value: { ...prepared, meta: { 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } } } })
    render(<><McpAppHostLayer /><McpAppView app={{ ...app, presentation: { toolTitle: 'Browse library', serverTitle: 'Fixture CAD', toolIcons: [{ src: 'data:image/svg+xml,%3Csvg/%3E' }] } }} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></>)
    await screen.findByText('Fixture CAD · Browse library')
    // A one-colour icon is painted in the header's text colour, named after its server.
    expect(await screen.findByRole('img', { name: 'fixture' })).toBeInTheDocument()
    // The header shows while preparing; the frame's context exists once it mounts.
    await screen.findByTestId('frame')
    expect(frame.props?.context.displayMode).toBe('inline')
    expect(frame.props?.context.availableDisplayModes).toEqual(['inline', 'fullscreen'])
  })

  it('explains the omitted initial result on the Activate button, not above the View, and drops it after activation', async () => {
    const s = setup()
    render(<><McpAppHostLayer /><McpAppView app={{ ...app, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' } }} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></>)
    const activate = await screen.findByRole('button', { name: 'mcpApp.activate' })
    expect(activate.hasAttribute('data-mcp-app-result-omitted')).toBe(true)
    expect(screen.queryByText('mcpApp.resultOmitted')).toBeNull()
    // View content can occupy its entire top-right corner. Activate is the last
    // action in the host header above it, before the trailing collapse toggle.
    const header = activate.closest('[data-embedded-tool-header]')
    expect(header).toBeTruthy()
    expect(activate.nextElementSibling).toBe(header?.querySelector('[data-embedded-tool-toggle]'))
    expect(header?.lastElementChild?.hasAttribute('data-embedded-tool-toggle')).toBe(true)
    expect(header?.parentElement?.querySelector('[data-mcp-app-surface]')).toBeTruthy()
    expect(activate.className).not.toContain('absolute')
    fireEvent.click(activate)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'mcpApp.activate' })).toBeNull())
    expect(s.api.mcpAppRequest).toHaveBeenCalledTimes(1)
  })

  it('bounds an oversized legacy result at the component boundary and keeps the restored View', async () => {
    const s = setup(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => render(<><McpAppHostLayer /><McpAppView app={{ ...app, toolResult: { content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] } }} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></>)).not.toThrow()
      expect((await screen.findByRole('button', { name: 'mcpApp.activate' })).hasAttribute('data-mcp-app-result-omitted')).toBe(true)
      expect(frame.props?.app.toolResult).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('prefers the visible main transcript over a later floating claim', async () => {
    const s = setup()
    render(<><McpAppHostLayer />
      <div data-testid="main-row"><McpAppView app={app} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></div>
      <div data-chat-panel data-testid="floating-row"><McpAppView app={app} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></div>
    </>)
    await waitFor(() => expect(within(screen.getByTestId('main-row')).queryByRole('button', { name: 'mcpApp.activate' })).toBeTruthy())
    expect(screen.getByTestId('floating-row').textContent).toBe('')
  })
  it('keeps a hidden claim parked and adopts it when its container becomes visible', async () => {
    const s = setup()
    render(<><McpAppHostLayer /><div data-testid="main-row" style={{ display: 'none' }}><McpAppView app={app} api={s.api} route={{ projectPath: '/original-project', sessionId: 'original' }} /></div></>)
    await screen.findByTestId('frame')
    expect(screen.getByTestId('main-row').textContent).toBe('')
    act(() => { screen.getByTestId('main-row').style.display = 'block' })
    await waitFor(() => expect(within(screen.getByTestId('main-row')).queryByRole('button', { name: 'mcpApp.activate' })).toBeTruthy())
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(1)
    expect(s.api.mcpAppRelease).not.toHaveBeenCalled()
  })
  it('hands a maximized floating transcript claim back to its mounted main row', async () => {
    const s = setup()
    const main = (hidden: boolean) => <div data-testid="main-row" style={{ display: hidden ? 'none' : undefined }}><McpAppView app={app} route={{ projectPath: '/original-project', sessionId: 'original' }} api={s.api} /></div>
    const floating = <div data-chat-panel data-testid="floating-row"><McpAppView app={app} route={{ projectPath: '/original-project', sessionId: 'original' }} api={s.api} /></div>
    const ui = render(<><McpAppHostLayer />{main(true)}{floating}</>)
    await waitFor(() => expect(within(screen.getByTestId('floating-row')).queryByRole('button', { name: 'mcpApp.activate' })).toBeTruthy())
    ui.rerender(<><McpAppHostLayer />{main(false)}</>)
    await waitFor(() => expect(within(screen.getByTestId('main-row')).queryByRole('button', { name: 'mcpApp.activate' })).toBeTruthy())
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(1)
    expect(s.api.mcpAppRelease).not.toHaveBeenCalled()
  })
  it('reloads after lost host activation without replaying the failed call', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValueOnce({ ok: true, value: { ...prepared, active: true } })
    s.mount(); await screen.findByTestId('frame'); expect(frame.props?.active).toBe(true)
    act(() => frame.props!.onError(new McpAppsError('inactive', 'Activate to reconnect')))
    expect(document.querySelector('[data-mcp-app-activate]')?.getAttribute('data-emphasized')).toBe('true')
    expect(frame.props?.active).toBe(false); expect(screen.getByRole('button', { name: 'mcpApp.activate' })).toBeTruthy()
    expect(s.api.mcpAppRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.activate' }))
    await waitFor(() => expect(frame.props?.active).toBe(true))
    expect(frame.initialized).toHaveLength(2)
    expect(s.api.mcpAppRequest).toHaveBeenCalledTimes(1)
  })
  it('paints restored snapshots without activating and reconnects only on explicit action', async () => {
    const s = setup(); const ui = s.mount(); await screen.findByTestId('frame')
    expect(s.api.mcpAppRequest).not.toHaveBeenCalled(); expect(frame.props?.active).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.activate' }))
    await waitFor(() => expect(frame.props?.active).toBe(true))
    expect(s.api.mcpAppRequest).toHaveBeenCalledWith('/original-project', 'original', { appInstanceId: 'v', operation: 'activate' })
    ui.unmount(); expect(s.api.mcpAppRelease).toHaveBeenCalledWith('doc')
  })
  it('reinitializes the same pinned document and context after activation without rerunning the origin tool', async () => {
    const s = setup(), saved = { ...app, resource: { hash: 'a'.repeat(64), meta: {} }, modelContext: { updateId: 'saved', content: [{ type: 'text' as const, text: 'Selected part' }], source: { appInstanceId: app.appInstanceId, server: app.binding.server } } }
    render(<><McpAppHostLayer /><McpAppView app={saved} route={{ projectPath: '/original-project', sessionId: 'original' }} api={s.api} /></>)
    await screen.findByTestId('frame')
    const document = frame.props?.registration
    fireEvent.click(await screen.findByRole('button', { name: 'mcpApp.activate' }))
    await waitFor(() => expect(frame.initialized).toHaveLength(2))
    expect(frame.props?.registration).toBe(document)
    expect(frame.props?.app.resource?.hash).toBe(saved.resource.hash)
    expect(frame.props?.app.binding).toEqual(saved.binding)
    expect(frame.props?.app.modelContext).toEqual(saved.modelContext)
    expect(frame.props?.active).toBe(true)
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(1)
    expect(vi.mocked(s.api.mcpAppRequest).mock.calls.map(call => call[2].operation)).toEqual(['activate'])
  })
  it('keeps the current View mounted and shows a failed activation', async () => {
    const s = setup()
    vi.mocked(s.api.mcpAppRequest).mockResolvedValue({ ok: false, error: { code: 'not_connected', message: 'Server unavailable' } })
    s.mount(); await screen.findByTestId('frame')
    const current = screen.getByTestId('frame')
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
    expect(screen.getByTestId('frame')).toBe(current)
    expect(frame.initialized).toHaveLength(1)
    expect(document.querySelector('[data-mcp-app-surface]')?.closest('[hidden]')).toBeNull()
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(1)
  })
  it('requires activation before preparing a missing historical snapshot', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValueOnce({ ok: true, value: { state: 'inactive' } })
    s.mount(); const activate = await screen.findByRole('button', { name: 'mcpApp.activate' }); expect(screen.queryByTestId('frame')).toBeNull()
    expect(activate.closest('[data-mcp-app-state-card]')).toBeTruthy(); expect(document.querySelector('.tool-node')).toBeNull()
    expect(document.querySelector('[data-embedded-tool-toggle]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.activate' })); await screen.findByTestId('frame')
    expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(2)
  })
  it('offers auth and retries preparation without replaying a failed mutation', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValueOnce({ ok: false, error: { code: 'auth_required', message: 'Sign in' } })
    s.mount(); const signIn = await screen.findByRole('button', { name: 'mcpApp.authenticate' })
    expect(signIn.closest('[data-mcp-app-state-card]')).toBeTruthy(); expect(screen.getByRole('alert')).toHaveTextContent('Sign in')
    fireEvent.click(signIn); await screen.findByTestId('frame')
    expect(s.api.mcpAppsAuthenticate).toHaveBeenCalledWith('local', { binding: app.binding, origin: app.origin })
    expect(vi.mocked(s.api.mcpAppRequest).mock.calls.map(call => call[2].operation)).toEqual(['activate'])
  })
  it('renders host consent as plain text, declines and shows unknown/revoked states', async () => {
    const s = setup(); s.mount(); await screen.findByTestId('frame')
    vi.mocked(s.api.mcpAppRequest).mockResolvedValue({ ok: false, error: { code: 'approval_required', challenge: 'c', prompt: { kind: 'sendMessage', server: 'fixture', text: '<img src=x onerror=evil()>', nonTextBlocks: 0 } } })
    let call!: Promise<unknown>
    act(() => { call = frame.props!.executor.sendMessage({ role: 'user', content: [{ type: 'text', text: '<img src=x onerror=evil()>' }] }, new AbortController().signal).catch(error => error) })
    await screen.findByText('<img src=x onerror=evil()>'); expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /mcpApp\.deny/ })); expect(await call).toMatchObject({ code: 'denied' }); expect(s.api.mcpAppRequest).toHaveBeenCalledTimes(1)
    act(() => frame.props!.onUnknown())
    expect(screen.getByText('mcpApp.unknown')).toBeTruthy()
    act(() => frame.props!.onRevoked())
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.restart' }))
    await waitFor(() => expect(s.api.mcpAppRegister).toHaveBeenCalledTimes(2))
  })
  it('queues message approvals in the session composer; Escape declines and Allow consumes the challenge once', async () => {
    const s = setup(); s.mount(); await screen.findByTestId('frame')
    const textOf = (request: Parameters<McpAppDesktopApi['mcpAppRequest']>[2]) => request.operation === 'sendMessage' && request.params.content[0]?.type === 'text' ? request.params.content[0].text : ''
    vi.mocked(s.api.mcpAppRequest).mockImplementation(async (_project, _session, request) => request.approval
      ? { ok: true, value: {} }
      : { ok: false, error: { code: 'approval_required', challenge: `c-${textOf(request)}`, prompt: { kind: 'sendMessage', server: 'fixture', text: textOf(request), nonTextBlocks: 0 } } })
    const send = (text: string) => frame.props!.executor.sendMessage({ role: 'user', content: [{ type: 'text', text }] }, new AbortController().signal).catch(error => error)
    let first!: Promise<unknown>, second!: Promise<unknown>
    act(() => { first = send('first'); second = send('second') })
    await screen.findByText('first')
    expect(document.querySelector('[data-mcp-app-consent-queue]')).toHaveTextContent('1/2')
    fireEvent.keyDown(document.querySelector('[data-mcp-app-consent]')!, { key: 'Escape' })
    expect(await first).toMatchObject({ code: 'denied' })
    await screen.findByText('second')
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.allow' }))
    expect(await second).toEqual({})
    expect(vi.mocked(s.api.mcpAppRequest).mock.calls.filter(call => call[2].approval).map(call => call[2].approval)).toEqual([{ challenge: 'c-second' }])
  })
  it('says where a View shown outside the transcript went and returns it inline', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValue({ ok: true, value: { ...prepared, active: true } })
    panel.closeMcpAppTab.mockImplementation((key: string) => useMcpAppLayout.getState().setMode(key, 'inline'))
    s.mount(); await screen.findByTestId('frame')
    expect(document.querySelector('[data-mcp-app-state-card]')).toBeNull()
    act(() => useMcpAppLayout.getState().setMode('v', 'pip'))
    expect(screen.getByText('mcpApp.shownInPip').closest('[data-mcp-app-state-card]')).toBeTruthy()
    act(() => useMcpAppLayout.getState().setMode('v', 'fullscreen'))
    expect(screen.getByText('mcpApp.shownInPanel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'mcpApp.inline' }))
    await waitFor(() => expect(document.querySelector('[data-mcp-app-state-card]')).toBeNull())
    expect(panel.closeMcpAppTab).toHaveBeenCalledWith('v')
  })
  it('offers panel and fullscreen header actions only for Views that declare fullscreen', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValue({ ok: true, value: { ...prepared, active: true } })
    s.mount()
    fireEvent.click(await screen.findByRole('button', { name: 'mcpApp.openInPanel' }))
    await waitFor(() => expect(panel.openMcpAppTab).toHaveBeenLastCalledWith('v', false))
    fireEvent.click(screen.getByRole('button', { name: 'tooltips.maximizeActivityPanel' }))
    await waitFor(() => expect(panel.openMcpAppTab).toHaveBeenLastCalledWith('v', true))
    cleanup(); frame.modes = ['inline']
    setup().mount(); await screen.findByTestId('frame')
    expect(screen.queryByRole('button', { name: 'mcpApp.openInPanel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'tooltips.maximizeActivityPanel' })).toBeNull()
  })
  it('collapses from the title without unmounting the View and expands again', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockResolvedValue({ ok: true, value: { ...prepared, active: true } })
    s.mount(); const current = await screen.findByTestId('frame')
    const surface = () => document.querySelector<HTMLElement>('[data-mcp-app-surface]')!
    const toggle = document.querySelector<HTMLElement>('[data-embedded-tool-toggle]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(surface().style.height).not.toBe('0px')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(surface().style.height).toBe('0px')
    expect(screen.getByTestId('frame')).toBe(current)
    fireEvent.click(document.querySelector<HTMLElement>('[data-embedded-tool-title]')!)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(surface().style.height).not.toBe('0px')
    expect(frame.initialized).toHaveLength(1)
  })
  it('shows preparation as a loading card under the plain header', async () => {
    const s = setup(); vi.mocked(s.api.mcpAppRegister).mockImplementation(() => new Promise(() => {}))
    s.mount()
    const card = (await screen.findByText('mcpApp.loading')).closest('[data-mcp-app-state-card]')
    expect(card).toBeTruthy(); expect(card?.querySelector('[data-mcp-app-action]')).toBeNull()
    expect(document.querySelector('[data-embedded-tool-header]')?.closest('[hidden]')).toBeNull()
    expect(document.querySelector('[data-embedded-tool-toggle]')).toBeNull()
  })
  it('releases a late registration when its shell has already unmounted', async () => {
    const s = setup(); let finish!: (value: any) => void
    vi.mocked(s.api.mcpAppRegister).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    s.mount().unmount(); await act(async () => finish({ ok: true, value: prepared }))
    expect(s.api.mcpAppRelease).toHaveBeenCalledWith('doc')
  })
})
