import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import { mcpAppStandaloneSessionId } from '@superone/shared/mcp-app-entrypoints'
import { sessionKey } from '@superone/shared/environment/refs'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { McpAppExecutor } from './executor-core'
import {
  closeStandaloneMcpAppsClients,
  resolveStandaloneServerConfig,
  setStandaloneMcpAppsDepsForTest,
} from './standalone-provider'

afterEach(() => {
  setStandaloneMcpAppsDepsForTest({})
  closeStandaloneMcpAppsClients()
})

describe('standalone Global MCP App provider and message handoff', () => {
  it('resolves user-scope servers without an open project and blocks project-scope or untrusted stdio servers', () => {
    const userHttp = { name: 'bits', type: 'http' as const, url: 'https://bits.example/mcp', scope: 'user' as const }
    const projectStdio = { name: 'repo-mcp', type: 'stdio' as const, command: './mcp', scope: 'project' as const }

    setStandaloneMcpAppsDepsForTest({
      codexConfigs: () => [userHttp, projectStdio],
      isTrustedProjectStdio: () => false,
    })

    const noProjectSession = mcpAppStandaloneSessionId('codex', '')
    const resolved = resolveStandaloneServerConfig(noProjectSession, 'bits')
    expect(resolved.fingerprint).toBe(mcpServerConfigFingerprint(userHttp))
    expect(resolved.projectPath).toBe('')

    expect(() => resolveStandaloneServerConfig(noProjectSession, 'repo-mcp')).toThrow(/not available/)

    const projectSession = mcpAppStandaloneSessionId('codex', '/proj')
    expect(() => resolveStandaloneServerConfig(projectSession, 'repo-mcp')).toThrow(/not trusted/)
  })

  it('hands off default active-target ui/message from a standalone Global App via createMessageSession', async () => {
    const standaloneSession = mcpAppStandaloneSessionId('codex', '/proj')
    const ref = { environmentId: 'local', sessionId: standaloneSession }
    const app: ToolAppAttachment = {
      appInstanceId: 'host-app:1',
      binding: {
        node: 'local',
        session: standaloneSession,
        server: 'bits',
        configGeneration: 0,
        configFingerprint: 'fp-1',
        hostClient: true,
      },
      origin: { providerSessionId: standaloneSession },
      resourceUri: 'ui://bits/library',
      toolName: 'cad.library',
      status: 'result',
    }

    const createMessageSession = vi.fn(async () => ({
      ref: { environmentId: 'local', sessionId: 'paired-sess-1' },
      projectPath: '/proj',
    }))
    const sendMessage = vi.fn(async () => {})

    const executor = new McpAppExecutor({
      resolve: async () => ({ ref, node: 'local', projectPath: '/proj', messageId: '', app }),
      persist: async () => {},
      provider: async () => ({ ok: true, value: { mode: 'gateway', resourceRead: true, toolCall: true, authenticate: false } }),
      createMessageSession,
      sendMessage,
    })
    executor.observeLive(ref, app)

    const key = sessionKey(ref)
    const challengeRes = await executor.execute(
      {
        sessionKey: key,
        appInstanceId: app.appInstanceId,
        operation: 'sendMessage',
        params: { role: 'user', content: [{ type: 'text', text: 'Inspect M6 bolt' }] },
      },
      { kind: 'desktop' },
      new AbortController().signal,
    )
    expect(challengeRes.ok).toBe(false)
    if (challengeRes.ok || challengeRes.error.code !== 'approval_required') {
      throw new Error('Expected approval_required challenge')
    }

    const preparedRes = await executor.execute(
      {
        sessionKey: key,
        appInstanceId: app.appInstanceId,
        operation: 'sendMessage',
        params: { role: 'user', content: [{ type: 'text', text: 'Inspect M6 bolt' }] },
        approval: { challenge: challengeRes.error.challenge },
      },
      { kind: 'desktop' },
      new AbortController().signal,
    )
    expect(createMessageSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'active')
    expect(preparedRes).toMatchObject({
      ok: true,
      value: {
        pendingSend: expect.any(String),
        route: { projectPath: '/proj', sessionId: 'paired-sess-1' },
      },
    })

    const pendingSend = (preparedRes as { ok: true; value: { pendingSend: string } }).value.pendingSend
    const sendRes = await executor.execute(
      {
        sessionKey: key,
        appInstanceId: app.appInstanceId,
        operation: 'sendPreparedMessage',
        pendingSend,
      },
      { kind: 'desktop' },
      new AbortController().signal,
    )
    expect(sendRes).toEqual({ ok: true, value: {} })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { environmentId: 'local', sessionId: 'paired-sess-1' },
        projectPath: '/proj',
      }),
      expect.anything(),
      { kind: 'desktop' },
      expect.anything(),
    )
  })
})
