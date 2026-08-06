/**
 * Production Host Action executor + consumer smoke with real executeSuperoneMcpTool path.
 * Browser layer is mocked — proves sessionId flows into the tool surface without inventing
 * a desktop SessionManager entry.
 *
 * session_rename is routed to EnvironmentHost (node RPC) instead of local SessionManager.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => ({
  executeBrowserTool: vi.fn(async (sessionId: string, toolName: string, args: unknown) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ sessionId, toolName, args }),
      },
    ],
  })),
  isBrowserToolName: (name: string) => name.startsWith('browser_'),
  getBrowserToolDescriptors: () => [],
  clearBrowserToolHandlers: vi.fn(),
}))

const envHost = vi.hoisted(() => ({
  renameSession: vi.fn(async (_connectionId: string, _sessionId: string, title: string) => ({
    title,
  })),
}))

vi.mock('../mcp/browser-mcp-tools', () => browser)
vi.mock('../computer-use/tools', () => ({
  executeComputerUseTool: vi.fn(),
  getComputerUseToolDescriptors: () => [],
  isComputerUseEnabled: () => false,
  isComputerUseToolName: () => false,
}))
vi.mock('../mcp/superone-mcp-server', () => ({
  dispatchAppToolCall: vi.fn(),
  executeMobileShareFileTool: vi.fn(),
  getAppToolDefs: () => new Map(),
  getSessionHost: () => null,
  getAppSettingsApplier: () => () => {},
  isMobileShareToolEnabled: () => false,
  notifyDevAppReady: vi.fn(),
}))
vi.mock('../mcp/superone-mcp-builtins', () => ({
  BUILT_IN_SUPERONE_TOOL_DEFS: [],
  BUILT_IN_SUPERONE_TOOL_NAMES: [],
  executeBuiltInSuperoneTool: vi.fn(),
}))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({ experimentalAgentCollaborationEnabled: false }),
}))
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => envHost,
}))

import { desktopHostActionExecutor } from './host-action-executor'
import type { ClaimHostActionResult } from '@superone/shared/environment'

function claimed(partial: Partial<ClaimHostActionResult> & Pick<ClaimHostActionResult, 'toolName' | 'sessionId'>): ClaimHostActionResult {
  return {
    actionId: 'a1',
    version: 2,
    claimToken: 'tok',
    claimExpiresAt: Date.now() + 60_000,
    toolGroup: 'session',
    args: {},
    replayPolicy: 'safe',
    turnId: null,
    ...partial,
  }
}

describe('desktopHostActionExecutor', () => {
  afterEach(() => {
    browser.executeBrowserTool.mockClear()
    envHost.renameSession.mockClear()
  })

  it('dispatches browser_snapshot with the node sessionId (tab owner key)', async () => {
    const action = claimed({
      toolName: 'browser_snapshot',
      toolGroup: 'browser.read',
      args: { include: ['meta'] },
      sessionId: 'node-session-uuid-xyz',
    })
    const ac = new AbortController()
    const out = await desktopHostActionExecutor(action, ac.signal, 'conn-1')
    expect(out.outcome).toBe('succeeded')
    expect(browser.executeBrowserTool).toHaveBeenCalledWith(
      'node-session-uuid-xyz',
      'browser_snapshot',
      { include: ['meta'] },
    )
    expect(envHost.renameSession).not.toHaveBeenCalled()
    // getSessionHost returns null — browser path does not require a desktop Session.
  })

  it('rejects session_collab_* with failed_precondition (node-local)', async () => {
    const action = claimed({
      toolName: 'session_collab_list_agents',
      toolGroup: 'superone',
      sessionId: 'node-session-uuid-xyz',
    })
    const ac = new AbortController()
    const out = await desktopHostActionExecutor(action, ac.signal, 'conn-1')
    expect(out.outcome).toBe('failed')
    expect(out.error).toMatchObject({ code: 'failed_precondition' })
    expect(browser.executeBrowserTool).not.toHaveBeenCalled()
    expect(envHost.renameSession).not.toHaveBeenCalled()
  })

  it('routes session_rename to EnvironmentHost.renameSession (node path)', async () => {
    const action = claimed({
      toolName: 'session_rename',
      args: { title: '  Fix remote rename  ' },
      sessionId: 'node-session-uuid-xyz',
    })
    const ac = new AbortController()
    const out = await desktopHostActionExecutor(action, ac.signal, 'conn-remote-1')

    expect(out.outcome).toBe('succeeded')
    expect(envHost.renameSession).toHaveBeenCalledWith(
      'conn-remote-1',
      'node-session-uuid-xyz',
      'Fix remote rename',
      'agent',
    )
    // Must not hit local MCP surface / browser (session-scoped routing).
    expect(browser.executeBrowserTool).not.toHaveBeenCalled()
    // Reply shape matches local renameSessionTool so the agent sees a consistent result.
    expect(out.result).toEqual({
      content: [{ type: 'text', text: 'Session renamed to "Fix remote rename".' }],
    })
  })

  it('maps node user_locked rejection to the local session_rename error text', async () => {
    envHost.renameSession.mockRejectedValueOnce(
      Object.assign(new Error('user_locked'), { code: 'user_locked' }),
    )
    const action = claimed({
      toolName: 'session_rename',
      args: { title: 'Agent try' },
      sessionId: 'node-s',
    })
    const out = await desktopHostActionExecutor(action, new AbortController().signal, 'conn-1')
    expect(out.outcome).toBe('failed')
    expect(out.result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session.',
        },
      ],
      isError: true,
    })
    expect(envHost.renameSession).toHaveBeenCalledWith('conn-1', 'node-s', 'Agent try', 'agent')
  })

  it('returns failed when aborted before session_rename execute', async () => {
    const action = claimed({
      toolName: 'session_rename',
      args: { title: 'Should not run' },
      sessionId: 's',
    })
    const ac = new AbortController()
    ac.abort()
    const out = await desktopHostActionExecutor(action, ac.signal, 'conn-1')
    expect(out.outcome).toBe('failed')
    expect((out.error as { code?: string })?.code).toBe('aborted')
    expect(envHost.renameSession).not.toHaveBeenCalled()
    expect(browser.executeBrowserTool).not.toHaveBeenCalled()
  })

  it('returns failed when aborted during session_rename (late result)', async () => {
    let resolveRename!: (value: { title: string }) => void
    let entered!: () => void
    const enteredGate = new Promise<void>((r) => {
      entered = r
    })
    envHost.renameSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve
          entered()
        }),
    )
    const action = claimed({
      toolName: 'session_rename',
      args: { title: 'Late title' },
      sessionId: 's-late',
    })
    const ac = new AbortController()
    const pending = desktopHostActionExecutor(action, ac.signal, 'conn-1')
    await enteredGate
    // Abort while rename is in flight, then let it finish.
    ac.abort()
    resolveRename({ title: 'Late' })
    const out = await pending
    expect(out.outcome).toBe('failed')
    expect((out.error as { code?: string })?.code).toBe('aborted')
    expect(envHost.renameSession).toHaveBeenCalled()
  })

  it('returns failed when aborted before browser execute', async () => {
    const action = claimed({
      toolName: 'browser_snapshot',
      toolGroup: 'browser.read',
      sessionId: 's',
    })
    const ac = new AbortController()
    ac.abort()
    const out = await desktopHostActionExecutor(action, ac.signal, 'conn-1')
    expect(out.outcome).toBe('failed')
    expect(browser.executeBrowserTool).not.toHaveBeenCalled()
  })
})
