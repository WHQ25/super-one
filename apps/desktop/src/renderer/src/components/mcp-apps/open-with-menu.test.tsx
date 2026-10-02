/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppFileHandler } from '@superone/shared/mcp-app-files'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
import { toast } from 'sonner'
import { useOpenWithMenu } from './open-with-menu'
import { McpAppOpenWithButton } from './McpAppOpenWith'
import { useMcpAppLayout } from './layout-store'

const handler: McpAppFileHandler = { server: 'cad', tool: 'cad.open', title: 'CAD viewer' }
const app: ToolAppAttachment = { appInstanceId: 'host-file:1', binding: { node: 'local', session: 's1', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  origin: { providerSessionId: 't' }, resourceUri: 'ui://cad/viewer', file: { name: 'part.stl', resourceUri: 'host-resource://1' }, status: 'result' }
let session = 0
let env: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  env = {
    mcpAppFileHandlers: vi.fn(async () => ({ ok: true, value: { handlers: [handler] } })),
    mcpAppOpenFile: vi.fn(async () => ({ ok: true, value: app })),
    mcpAppCloseFile: vi.fn(async () => {}),
  }
  Object.assign(window, { environment: env })
})
afterEach(() => { cleanup(); useMcpAppLayout.setState({ views: {} }) })

let latest: { entries: AdaptiveMenuEntry[]; prefetch: () => void }
function Menu({ scope, path }: { scope: { projectPath: string; sessionId: string }; path: string }) {
  latest = useOpenWithMenu(path, { scope, openInSuperOne: () => {} })
  return <>{latest.entries.map(entry => entry.kind === 'submenu' ? entry.items.map(item => item.kind === 'item' ? <span key={item.id}>{item.label}</span> : null) : null)}</>
}

describe('Open With an MCP App', () => {
  it('asks only when the menu opens, then offers SuperOne Preview and each App', async () => {
    const scope = { projectPath: '/w', sessionId: `s${++session}` }
    render(<Menu scope={scope} path="/w/parts/part.STL" />)
    expect(env.mcpAppFileHandlers).not.toHaveBeenCalled()
    expect(latest.entries).toEqual([])
    act(() => latest.prefetch())
    expect(await screen.findByText('CAD viewer')).toBeTruthy()
    expect(screen.getByText('mcpApp.superOnePreview')).toBeTruthy()
    expect(env.mcpAppFileHandlers).toHaveBeenCalledWith('/w', scope.sessionId, '/w/parts/part.STL', {})
    // Another file of the same type in the same session reuses the answer.
    act(() => latest.prefetch())
    expect(env.mcpAppFileHandlers).toHaveBeenCalledTimes(1)
  })

  it('asks again after an answer missing servers that were still starting', async () => {
    env.mcpAppFileHandlers.mockResolvedValueOnce({ ok: true, value: { handlers: [], incomplete: true } })
    render(<Menu scope={{ projectPath: '/w', sessionId: `s${++session}` }} path="/w/part.stl" />)
    act(() => latest.prefetch())
    await waitFor(() => expect(env.mcpAppFileHandlers).toHaveBeenCalledTimes(1))
    act(() => latest.prefetch())
    expect(await screen.findByText('CAD viewer')).toBeTruthy()
    expect(env.mcpAppFileHandlers).toHaveBeenCalledTimes(2)
  })

  it('opens the file in the pane session as a host View that is released when its tab closes', async () => {
    const scope = { projectPath: '/w', sessionId: `s${++session}` }
    render(<Menu scope={scope} path="/w/part.stl" />)
    act(() => latest.prefetch())
    await screen.findByText('CAD viewer')
    const submenu = latest.entries[0] as Extract<AdaptiveMenuEntry, { kind: 'submenu' }>
    const item = submenu.items.find(entry => entry.kind === 'item' && entry.label === 'CAD viewer') as Extract<AdaptiveMenuEntry, { kind: 'item' }>
    act(() => item.onSelect())
    await waitFor(() => expect(useMcpAppLayout.getState().views[app.appInstanceId]).toMatchObject({ mode: 'fullscreen', row: null, route: scope }))
    expect(env.mcpAppOpenFile).toHaveBeenCalledWith('/w', scope.sessionId, { server: 'cad', tool: 'cad.open', path: '/w/part.stl' })
    act(() => useMcpAppLayout.getState().setMode(app.appInstanceId, 'inline'))
    expect(useMcpAppLayout.getState().views[app.appInstanceId]).toBeUndefined()
    expect(env.mcpAppCloseFile).toHaveBeenCalledWith('/w', scope.sessionId, app.appInstanceId)
  })

  it('reports a failed open', async () => {
    env.mcpAppOpenFile.mockResolvedValue({ ok: false, error: { code: 'not_connected', message: 'server down' } })
    render(<Menu scope={{ projectPath: '/w', sessionId: `s${++session}` }} path="/w/part.stl" />)
    act(() => latest.prefetch())
    await screen.findByText('CAD viewer')
    const submenu = latest.entries[0] as Extract<AdaptiveMenuEntry, { kind: 'submenu' }>
    act(() => (submenu.items[2] as Extract<AdaptiveMenuEntry, { kind: 'item' }>).onSelect())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('mcpApp.openFileFailed'))
    expect(useMcpAppLayout.getState().views).toEqual({})
  })

  it('looks up passively from an open preview and shows nothing while the harness is idle', async () => {
    env.mcpAppFileHandlers.mockResolvedValue({ ok: true, value: { handlers: [], unavailable: 'no-session' } })
    const scope = { projectPath: '/w', sessionId: `s${++session}` }
    render(<McpAppOpenWithButton absolutePath="/w/part.stl" scope={scope} />)
    await waitFor(() => expect(env.mcpAppFileHandlers).toHaveBeenCalledWith('/w', scope.sessionId, '/w/part.stl', { passive: true }))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
