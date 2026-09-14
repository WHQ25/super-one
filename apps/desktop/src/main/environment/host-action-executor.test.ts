/**
 * Production Host Action executor + consumer smoke with real executeSuperoneMcpTool path.
 * Browser layer is mocked — proves sessionId flows into the tool surface without inventing
 * a desktop SessionManager entry.
 *
 * session_rename is routed to EnvironmentHost (node RPC) instead of local SessionManager.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactPutRequest } from '@superone/shared/environment'

const zoneState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => zoneState.userData } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())

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

/** What a node with a sync zone looks like from the executor: a zone, artifact RPCs, a transfer service. */
const node = vi.hoisted(() => {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, Buffer[]>()
  let wakes = 0
  return {
    files,
    parts,
    wakes: () => wakes,
    wake: () => { wakes++ },
    zone: null as { syncRoot: string; os: 'linux' } | null,
    put: async (_c: string, req: ArtifactPutRequest) => {
      const chunks = parts.get(req.transferId) ?? []
      chunks.push(Buffer.from(req.chunk, 'base64'))
      parts.set(req.transferId, chunks)
      const written = chunks.reduce((n, c) => n + c.length, 0)
      if (!req.final) return { ok: true as const, bytesWritten: written }
      const whole = Buffer.concat(chunks)
      if (createHash('sha256').update(whole).digest('hex') !== req.sha256) throw new Error('sha mismatch')
      files.set(req.relativePath, whole)
      return { ok: true as const, bytesWritten: written, mtimeMs: 1_700_000_000_000 }
    },
  }
})

const envHost = vi.hoisted(() => ({
  renameSession: vi.fn(async (_connectionId: string, _sessionId: string, title: string) => ({
    title,
  })),
  getSyncZone: () => node.zone,
  artifactPut: (c: string, req: ArtifactPutRequest) => node.put(c, req),
  artifactGet: async (_c: string, req: { relativePath: string; offset: number; maxBytes: number }) => {
    const f = node.files.get(req.relativePath)!
    const slice = f.subarray(req.offset, req.offset + req.maxBytes)
    return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
  },
  artifactStat: async (_c: string, _s: string, relativePath: string) => {
    const f = node.files.get(relativePath)
    return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
  },
  artifactTransfers: {
    throughputBytesPerMs: () => 1024,
    recordThroughput: () => {},
    wake: () => node.wake(),
  },
}))

/** Registered refs the fake tool surface hands back with its result. */
const registry = vi.hoisted(() => ({ artifacts: [] as { path: string; producer: 'browser'; final: boolean; deliveryId?: string }[] }))

const mcpSurface = vi.hoisted(() => ({
  executeSuperoneMcpTool: vi.fn(async (sessionId: string, toolName: string, args: unknown) => {
    if (toolName.startsWith('browser_')) {
      return browser.executeBrowserTool(sessionId, toolName, args)
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok', tags: ['oauth'] }) }],
    }
  }),
  executeSuperoneMcpToolCollecting: async (sessionId: string, toolName: string, args: unknown) => ({
    result: await mcpSurface.executeSuperoneMcpTool(sessionId, toolName, args),
    artifacts: registry.artifacts.splice(0),
  }),
}))

const renameTags = vi.hoisted(() => ({
  applyRenameTags: vi.fn(() => ['oauth'] as string[] | { error: string }),
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
  getAppToolDefs: () => new Map(),
  getSessionHost: () => null,
  getAppSettingsApplier: () => () => {},
  notifyDevAppReady: vi.fn(),
}))
vi.mock('../mcp/superone-mcp-builtins', () => ({
  BUILT_IN_SUPERONE_TOOL_DEFS: [],
  BUILT_IN_SUPERONE_TOOL_NAMES: [],
  executeBuiltInSuperoneTool: vi.fn(),
}))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({}),
}))
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => envHost,
}))
vi.mock('../mcp/superone-mcp-tool-surface', () => mcpSurface)
vi.mock('../mcp/session-tag-tools', () => renameTags)

import { desktopHostActionExecutor } from './host-action-executor'
import type { ClaimHostActionResult } from '@superone/shared/environment'
import { resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests } from './delivery-holders'
import { sealZoneFile } from './zone-delivery'
import { findDeliveryByPath } from '../db-session-deliveries'

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
  beforeEach(() => {
    zoneState.userData = mkdtempSync(join(tmpdir(), 'ha-exec-'))
  })
  afterEach(() => {
    rmSync(zoneState.userData, { recursive: true, force: true })
    node.zone = null
    node.files.clear()
    node.parts.clear()
    registry.artifacts.length = 0
    resetDeliveryDatabase()
    _resetHoldersForTests()
    browser.executeBrowserTool.mockClear()
    envHost.renameSession.mockClear()
    mcpSurface.executeSuperoneMcpTool.mockClear()
    renameTags.applyRenameTags.mockClear()
    renameTags.applyRenameTags.mockImplementation(() => ['oauth'])
  })

  describe('session sync zone', () => {
    function desktopArtifact(sessionId: string, rel: string, data: string): string {
      const path = join(zoneState.userData, 'sync', sessionId, ...rel.split('/'))
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, data)
      return path
    }

    it('pushes a screenshot to the node zone and hands the agent the node path', async () => {
      node.zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' }
      const shot = desktopArtifact('node-s', 'browser/shot.png', 'png-bytes')
      browser.executeBrowserTool.mockImplementationOnce(async () => {
        // The producer seals the file as a delivery for this node, exactly as
        // the real screenshot store does; the ref carries the id.
        const deliveryId = sealZoneFile({ sessionId: 'node-s', path: shot, origin: 'produced', connectionId: 'conn-1', bytes: 'png-bytes' })!
        registry.artifacts.push({ path: shot, producer: 'browser', final: true, deliveryId })
        return { content: [{ type: 'text' as const, text: JSON.stringify({ path: shot, width: 1, height: 1 }) }] }
      })
      const out = await desktopHostActionExecutor(
        claimed({ toolName: 'browser_screenshot', toolGroup: 'browser.read', sessionId: 'node-s' }),
        new AbortController().signal,
        'conn-1',
      )
      expect(out.outcome).toBe('succeeded')
      const reply = out.result as { content: { text: string }[] }
      expect(JSON.parse(reply.content[0].text).path).toBe('/home/node/.superone/node/sync/node-s/browser/shot.png')
      expect(node.files.get('browser/shot.png')!.toString()).toBe('png-bytes')
      expect(findDeliveryByPath('node-s', shot)).toMatchObject({ phase: 'notifying', outcome: 'done' })
    })

    it('maps a node zone path in the args to the desktop mirror before the tool runs', async () => {
      node.zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' }
      node.files.set('agent/chart.png', Buffer.from('chart'))
      await desktopHostActionExecutor(
        claimed({
          toolName: 'browser_upload',
          toolGroup: 'browser.act',
          sessionId: 'node-s',
          args: { path: '/home/node/.superone/node/sync/node-s/agent/chart.png' },
        }),
        new AbortController().signal,
        'conn-1',
      )
      expect(browser.executeBrowserTool).toHaveBeenCalledWith('node-s', 'browser_upload', {
        path: join(zoneState.userData, 'sync', 'node-s', 'agent', 'chart.png'),
      })
    })

    it('leaves an older node without a zone on the old behaviour: no push, no rewrite', async () => {
      node.zone = null
      const shot = desktopArtifact('node-s', 'browser/shot.png', 'png-bytes')
      browser.executeBrowserTool.mockImplementationOnce(async () => {
        registry.artifacts.push({ path: shot, producer: 'browser', final: true })
        return { content: [{ type: 'text' as const, text: JSON.stringify({ path: shot }) }] }
      })
      const out = await desktopHostActionExecutor(
        claimed({ toolName: 'browser_screenshot', toolGroup: 'browser.read', sessionId: 'node-s' }),
        new AbortController().signal,
        'conn-1',
      )
      const reply = out.result as { content: { text: string }[] }
      expect(JSON.parse(reply.content[0].text).path).toBe(shot)
      expect(node.files.size).toBe(0)
    })
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

  it('routes session_tag to the host archive MCP surface, not the node store', async () => {
    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: 'node-s',
        args: { add: ['oauth'] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(out.outcome).toBe('succeeded')
    expect(mcpSurface.executeSuperoneMcpTool).toHaveBeenCalledWith(
      'node-s',
      'session_tag',
      { add: ['oauth'] },
    )
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

  it('rejects empty session_rename title before applying tags', async () => {
    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_rename',
        args: { title: '   ', tags: ['oauth'] },
        sessionId: 'node-s',
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(out.outcome).toBe('failed')
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
    expect(envHost.renameSession).not.toHaveBeenCalled()
  })

  it('applies host-archive tags when remote rename is user_locked', async () => {
    envHost.renameSession.mockRejectedValueOnce(
      Object.assign(new Error('user_locked'), { code: 'user_locked' }),
    )
    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_rename',
        args: { title: 'Agent try', tags: ['oauth'] },
        sessionId: 'node-s',
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(out.outcome).toBe('failed')
    expect(renameTags.applyRenameTags).toHaveBeenCalledWith('node-s', ['oauth'])
    expect(out.result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session. Tags applied. Tags: ["oauth"].',
        },
      ],
      isError: true,
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
