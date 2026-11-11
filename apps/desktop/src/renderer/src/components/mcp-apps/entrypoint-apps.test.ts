import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mcpAppEntrypointKey,
  mcpAppStandaloneSessionId,
  type McpAppEntrypointDescriptor,
} from '@superone/shared/mcp-app-entrypoints'
import type { McpAppHostUpdate, ToolAppAttachment } from '@superone/shared/mcp-apps'

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ projectSessions: {} })),
  }),
}))

const navigateMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('./session-navigation', () => ({
  navigateMcpAppSession: (...args: unknown[]) => navigateMock(...args),
}))

import { openMcpAppFromDrawer, type ActiveMcpAppDrawerContext } from './entrypoint-apps'
import { useMcpAppLayout } from './layout-store'

function buildApp(id: string, sessionId: string, server: string, toolName: string): ToolAppAttachment {
  return {
    appInstanceId: id,
    binding: {
      node: 'local',
      session: sessionId,
      server,
      configGeneration: 0,
      configFingerprint: 'fp',
      hostClient: true,
    },
    origin: { providerSessionId: sessionId },
    resourceUri: `ui://${server}/view.html`,
    toolName,
    status: 'pending',
  }
}

const threadAndGlobalApp: McpAppEntrypointDescriptor = {
  key: mcpAppEntrypointKey('claude', 'linear', 'open_board'),
  server: 'linear',
  tool: 'open_board',
  title: 'Sprint Board',
  resourceUri: 'ui://linear/board.html',
  harness: 'claude',
  kinds: ['global', 'thread'],
}

const pureGlobalApp: McpAppEntrypointDescriptor = {
  key: mcpAppEntrypointKey('codex', 'cad', 'open_library'),
  server: 'cad',
  tool: 'open_library',
  title: 'CAD Library',
  resourceUri: 'ui://cad/library.html',
  harness: 'codex',
  kinds: ['global'],
}

const pureThreadApp: McpAppEntrypointDescriptor = {
  key: mcpAppEntrypointKey('codex', 'cad', 'open_tray'),
  server: 'cad',
  tool: 'open_tray',
  title: 'CAD Tray',
  resourceUri: 'ui://cad/tray.html',
  harness: 'codex',
  kinds: ['thread'],
}

describe('openMcpAppFromDrawer', () => {
  let hostListener: ((event: { sessionId: string; projectPath: string; appInstanceId: string; update: McpAppHostUpdate }) => void) | null = null
  let env: {
    listProjects: ReturnType<typeof vi.fn>
    getSession: ReturnType<typeof vi.fn>
    removeSession: ReturnType<typeof vi.fn>
    createSession: ReturnType<typeof vi.fn>
    mcpAppOpenEntrypoint: ReturnType<typeof vi.fn>
    mcpAppCloseFile: ReturnType<typeof vi.fn>
    onMcpAppHostUpdated: ReturnType<typeof vi.fn>
  }
  let instanceCounter = 0

  beforeEach(() => {
    instanceCounter = 0
    hostListener = null
    env = {
      listProjects: vi.fn(async () => [{ projectId: 'proj-uuid-1', path: '/proj' }]),
      getSession: vi.fn(async (_envId: string, sessionId: string) => ({ sessionId, harnessId: 'claude' })),
      removeSession: vi.fn(async () => {}),
      createSession: vi.fn(async (_envId: string, input: { selections?: { sessionId?: string } }) => ({
        sessionId: input.selections?.sessionId ?? 'new-sess-1',
      })),
      mcpAppOpenEntrypoint: vi.fn(async (_project: string, sessionId: string, req: { server: string; tool: string }) => ({
        ok: true,
        value: buildApp(`host-${++instanceCounter}`, sessionId, req.server, req.tool),
      })),
      mcpAppCloseFile: vi.fn(async () => {}),
      onMcpAppHostUpdated: vi.fn((cb) => {
        hostListener = cb
        return () => { hostListener = null }
      }),
    }
    vi.stubGlobal('window', { environment: env })
    useMcpAppLayout.setState({ views: {}, overlays: {} })
  })

  afterEach(() => {
    useMcpAppLayout.setState({ views: {}, overlays: {} })
    vi.unstubAllGlobals()
  })

  it('opens a global entrypoint without any project or session and never creates a chat session', async () => {
    const noProjectContext: ActiveMcpAppDrawerContext = {
      projectPath: '',
      sessionId: null,
      hasSession: false,
      provider: null,
      harness: null,
      isEmptyDraft: false,
    }

    await openMcpAppFromDrawer(noProjectContext, pureGlobalApp, false)

    const standaloneId = mcpAppStandaloneSessionId('codex', '')
    expect(env.createSession).not.toHaveBeenCalled()
    expect(env.mcpAppOpenEntrypoint).toHaveBeenCalledWith('', standaloneId, {
      server: 'cad',
      tool: 'open_library',
      entrypoint: 'global',
    })
    expect(useMcpAppLayout.getState().views['host-1']).toMatchObject({
      mode: 'fullscreen',
      row: null,
      route: { projectPath: '', sessionId: standaloneId },
    })

    await openMcpAppFromDrawer(noProjectContext, pureGlobalApp, true)
    expect(env.mcpAppOpenEntrypoint).toHaveBeenCalledTimes(1)
  })

  it('opens a pure global entrypoint standalone even when a non-empty conversation is active', async () => {
    const busyContext: ActiveMcpAppDrawerContext = {
      projectPath: '/proj',
      sessionId: 'sess-busy',
      hasSession: true,
      provider: 'codex',
      harness: 'codex',
      isEmptyDraft: false,
    }

    await openMcpAppFromDrawer(busyContext, pureGlobalApp, false)

    const standaloneId = mcpAppStandaloneSessionId('codex', '/proj')
    expect(env.createSession).not.toHaveBeenCalled()
    expect(env.mcpAppOpenEntrypoint).toHaveBeenCalledWith('/proj', standaloneId, {
      server: 'cad',
      tool: 'open_library',
      entrypoint: 'global',
    })
  })

  it('opens a thread-capable entrypoint directly inside an active non-empty session', async () => {
    const context: ActiveMcpAppDrawerContext = {
      projectPath: '/proj',
      sessionId: 'sess-active',
      hasSession: true,
      provider: 'claude',
      harness: 'claude',
      isEmptyDraft: false,
    }

    await openMcpAppFromDrawer(context, threadAndGlobalApp, false)

    expect(env.createSession).not.toHaveBeenCalled()
    expect(env.mcpAppOpenEntrypoint).toHaveBeenCalledWith('/proj', 'sess-active', {
      server: 'linear',
      tool: 'open_board',
      entrypoint: 'thread',
    })
    expect(useMcpAppLayout.getState().views['host-1']).toMatchObject({
      mode: 'fullscreen',
      row: null,
      route: { projectPath: '/proj', sessionId: 'sess-active' },
    })
  })

  it('replaces a prewarmed draft on another harness for a pure thread entrypoint and applies async host toolResult updates', async () => {
    env.getSession.mockResolvedValueOnce({ sessionId: 'sess-draft-codex', harnessId: 'acp' })

    const codexDraftContext: ActiveMcpAppDrawerContext = {
      projectPath: '/proj',
      sessionId: 'sess-draft-codex',
      hasSession: true,
      provider: 'codex',
      harness: 'codex',
      isEmptyDraft: true,
    }

    await openMcpAppFromDrawer(codexDraftContext, pureThreadApp, false)

    expect(env.removeSession).toHaveBeenCalledWith('local', 'sess-draft-codex')
    expect(env.createSession).toHaveBeenCalledWith('local', {
      projectId: 'proj-uuid-1',
      harnessId: 'codex',
      cwd: '/proj',
      selections: { sessionId: 'sess-draft-codex' },
    })
    expect(useMcpAppLayout.getState().views['host-1']?.app.status).toBe('pending')

    hostListener?.({
      sessionId: 'sess-draft-codex',
      projectPath: '/proj',
      appInstanceId: 'host-1',
      update: {
        status: 'result',
        toolResult: { content: [{ type: 'text', text: 'Tray ready' }] },
      },
    })

    expect(useMcpAppLayout.getState().views['host-1']?.app).toMatchObject({
      status: 'result',
      toolResult: { content: [{ type: 'text', text: 'Tray ready' }] },
    })
  })
})
