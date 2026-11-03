/**
 * Production Host Action executor + consumer smoke with real executeSuperoneMcpTool path.
 * Browser layer is mocked — proves sessionId flows into the tool surface without inventing
 * a desktop SessionManager entry.
 *
 * session_rename, session_tag, and session_cleanup are routed to EnvironmentHost (node RPC) instead of the desktop archive.
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
  environmentIdOf: (connectionId: string) => (connectionId === 'conn-1' ? 'env-1' : null),
  renameSession: vi.fn(async (_connectionId: string, _sessionId: string, title: string) => ({
    title,
  })),
  setSessionTags: vi.fn(async (_connectionId: string, _sessionId: string, _op: { set?: unknown }) => ({
    tags: [] as string[],
  })),
  cleanupSession: vi.fn(async () => ({ status: 'ok', action: 'settle', affected: [] as unknown[] })),
  renewHostActionClaim: vi.fn(async () => Date.now() + 60_000),
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
    held: new Map(),
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
const collab = vi.hoisted(() => ({
  runRemoteChildMailboxTool: vi.fn(async (..._args: unknown[]) => ({
    reply: { content: [{ type: 'text', text: '{"status":"sent"}' }] } as { content: Array<{ type: 'text'; text: string }>; isError?: boolean },
  } as { reply: { content: Array<{ type: 'text'; text: string }>; isError?: boolean }; onResponded?: () => void })),
}))
vi.mock('../session/session-collaboration', () => collab)

import { desktopHostActionExecutor } from './host-action-executor'
import { remoteListObserver } from './remote-list-observer'
import type { ClaimHostActionResult, EnvironmentEventEnvelope } from '@superone/shared/environment'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { applySessionTagOp, parseSessionTagOp } from '@superone/shared/session-tags'
import { runSessionCleanup } from '@superone/runtime/session/session-cleanup'
import {
  createSimulatedTurnRunner,
  SessionRuntime,
  type LeaseGuard,
  type NodeSessionRecord,
  type SessionEventLog,
  type SessionStore,
} from '@superone/runtime/session'
import { createNodeSessionListNotices } from '../../../../cli/src/session/session-list-notices'
import { resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests } from './delivery-holders'
import { sealZoneFile } from './zone-delivery'
import { findDeliveryByPath } from '../db-session-deliveries'
import { noteAcpTaskLifecycle, PARENT_CALL_WAIT_MS, _resetMainThreadSessionGuardForTests } from '../mcp/main-thread-session-guard'

function nodeRuntime() {
  const rows = new Map<string, NodeSessionRecord>()
  const appended: Array<{ sessionId: string; eventType: string; payload: unknown }> = []
  const store: SessionStore = {
    loadAll: () => [...rows.values()],
    save: (session) => {
      rows.set(session.sessionId, { ...session, transcript: session.transcript.map((block) => ({ ...block })), tags: [...(session.tags ?? [])] })
    },
    delete: (id) => { rows.delete(id) },
  }
  const events: SessionEventLog = {
    epoch: 'test',
    headSequence: () => '0',
    listAfter: () => [],
    streamingAfter: () => [],
    streaming: () => [],
    onAppend: () => () => {},
    appendSession: (input) => {
      appended.push({ sessionId: input.sessionId, eventType: input.eventType, payload: input.payload })
      return appended.length
    },
  }
  const leases: LeaseGuard = { assertValid: () => {} }
  const runtime = new SessionRuntime(store, events, leases, 'env-1', createSimulatedTurnRunner({ delayMs: 0 }), {
    runtimeReaperIntervalMs: 0,
  })
  return { runtime, rows, appended }
}

/** Stand in for the node RPC client: session.setTags / session.rename on the owning runtime. */
function bindNodeRpc(runtime: SessionRuntime) {
  envHost.setSessionTags.mockImplementation(async (_connectionId: string, sessionId: string, op: { add?: unknown; remove?: unknown; set?: unknown }) => {
    const parsed = parseSessionTagOp(op)
    if ('error' in parsed) throw Object.assign(new Error(parsed.error), { code: 'invalid_argument' })
    const session = runtime.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    const next = applySessionTagOp(session.tags ?? [], parsed)
    if ('error' in next) throw Object.assign(new Error(next.error), { code: 'failed_precondition' })
    return runtime.setTags(sessionId, next)
  })
  envHost.renameSession.mockImplementation(async (_connectionId: string, sessionId: string, title: string, source?: 'user' | 'agent') => (
    runtime.rename(sessionId, title, source ?? 'user')
  ))
  envHost.cleanupSession.mockImplementation(async (_connectionId: string, input: {
    action: unknown
    sessionIds: unknown
    sourceSessionId: string
    includePinned?: boolean
    maxDelete?: unknown
  }) => runSessionCleanup(runtime, input))
}

function listFramesFor(runtime: SessionRuntime, appended: Array<{ sessionId: string; eventType: string; payload: unknown }>) {
  const notices = createNodeSessionListNotices({
    environmentId: 'env-1',
    listSessions: () => [...runtime.list()],
    getSession: (sessionId) => runtime.get(sessionId),
    projectPath: (projectId) => (projectId === 'p1' ? '/work/app' : null),
  })
  const frames: Array<{ events: Array<{ type: string; projectPath?: string }> }> = []
  notices.topicNotices.open({
    topics: [{ kind: 'sessionList', environmentId: 'env-1' }],
    cursors: {},
    snapshot: () => ({ sessions: [] }),
    push: (frame) => frames.push(frame as { events: Array<{ type: string; projectPath?: string }> }),
  })
  frames.length = 0
  for (const event of appended) {
    const envelope: EnvironmentEventEnvelope = {
      eventId: event.eventType,
      sequence: '1',
      timestamp: 1,
      aggregateType: 'session',
      aggregateId: event.sessionId,
      eventType: event.eventType,
      eventVersion: 1,
      payload: event.payload as EnvironmentEventEnvelope['payload'],
      environmentId: 'env-1',
    }
    notices.onSessionEvent(envelope)
  }
  return frames
}

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
    envHost.renameSession.mockReset()
    envHost.renameSession.mockImplementation(async (_connectionId: string, _sessionId: string, title: string) => ({ title }))
    envHost.setSessionTags.mockReset()
    envHost.setSessionTags.mockImplementation(async () => ({ tags: [] as string[] }))
    envHost.cleanupSession.mockReset()
    envHost.cleanupSession.mockImplementation(async () => ({ status: 'ok', action: 'settle', affected: [] as unknown[] }))
    envHost.renewHostActionClaim.mockClear()
    mcpSurface.executeSuperoneMcpTool.mockClear()
    renameTags.applyRenameTags.mockClear()
    renameTags.applyRenameTags.mockImplementation(() => ['oauth'])
    _resetMainThreadSessionGuardForTests()
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

  it('runs a remote collaboration child\'s mailbox tools against this desktop\'s mailbox', async () => {
    const out = await desktopHostActionExecutor(
      claimed({ toolName: 'session_collab_send', toolGroup: 'superone', sessionId: 'remote-child', args: { content: 'done' } }),
      new AbortController().signal,
      'conn-1',
    )
    expect(out).toEqual({ outcome: 'succeeded', result: { content: [{ type: 'text', text: '{"status":"sent"}' }] } })
    expect(collab.runRemoteChildMailboxTool).toHaveBeenCalledWith('env-1', 'remote-child', 'session_collab_send', { content: 'done' })

    // A retrieve commits once the node has the reply.
    const ack = vi.fn()
    collab.runRemoteChildMailboxTool.mockResolvedValueOnce({ reply: { content: [{ type: 'text', text: '{"status":"messages"}' }] }, onResponded: ack })
    const read = await desktopHostActionExecutor(
      claimed({ toolName: 'session_collab_retrieve', toolGroup: 'superone', sessionId: 'remote-child' }),
      new AbortController().signal,
      'conn-1',
    )
    expect(read.onResponded).toBe(ack)
    expect(ack).not.toHaveBeenCalled()

    collab.runRemoteChildMailboxTool.mockResolvedValueOnce({ reply: { content: [{ type: 'text', text: '{"status":"error"}' }], isError: true } })
    const refused = await desktopHostActionExecutor(
      claimed({ toolName: 'session_collab_retrieve', toolGroup: 'superone', sessionId: 'stranger' }),
      new AbortController().signal,
      'conn-1',
    )
    expect(refused.outcome).toBe('failed')
  })

  it('stores a node-only session_tag on that node and refreshes the desktop list', async () => {
    const { runtime, rows, appended } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    appended.length = 0
    bindNodeRpc(runtime)

    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: created.sessionId,
        args: { add: ['OAuth'] },
      }),
      new AbortController().signal,
      'conn-1',
    )

    expect(out.outcome).toBe('succeeded')
    expect(JSON.parse((out.result as { content: Array<{ text: string }> }).content[0].text)).toEqual({
      status: 'ok',
      sessionId: created.sessionId,
      tags: ['oauth'],
    })
    expect(rows.get(created.sessionId)?.tags).toEqual(['oauth'])
    expect(appended.map((event) => event.eventType)).toEqual([SESSION_DURABLE_EVENT.tagsChanged])
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
    const frames = listFramesFor(runtime, appended)
    expect(frames.map((frame) => frame.events[0])).toEqual([
      { type: 'session_list_changed', projectPath: '/work/app' },
    ])
    await runtime.dispose()
  })

  it('applies remove and set on the node, and reports a missing id without a desktop row', async () => {
    const { runtime, rows, appended } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    runtime.setTags(created.sessionId, ['oauth', 'voice'])
    appended.length = 0
    bindNodeRpc(runtime)

    const removed = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: created.sessionId,
        args: { remove: ['Voice'] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(JSON.parse((removed.result as { content: Array<{ text: string }> }).content[0].text)).toEqual({
      status: 'ok',
      sessionId: created.sessionId,
      tags: ['oauth'],
    })

    const replaced = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: created.sessionId,
        args: { set: ['bug', 'remote-node'] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(rows.get(created.sessionId)?.tags).toEqual(['bug', 'remote-node'])
    expect(JSON.parse((replaced.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
      status: 'ok',
      tags: ['bug', 'remote-node'],
    })

    const other = runtime.create({ projectId: 'p1', title: '另一条' })
    const bulk = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: created.sessionId,
        args: { sessionIds: [created.sessionId, other.sessionId, 'missing-on-node'], add: ['review'] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    const body = JSON.parse((bulk.result as { content: Array<{ text: string }> }).content[0].text) as {
      status: string
      count: number
      missing?: string[]
    }
    expect(body.status).toBe('partial')
    expect(body.count).toBe(2)
    expect(body.missing).toEqual(['missing-on-node'])
    expect(rows.get(created.sessionId)?.tags).toEqual(['bug', 'remote-node', 'review'])
    expect(rows.get(other.sessionId)?.tags).toEqual(['review'])
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('rejects an invalid remote session_tag before writing the node', async () => {
    const { runtime, rows } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    bindNodeRpc(runtime)
    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_tag',
        sessionId: created.sessionId,
        args: { add: ['bad tag!'], set: ['also'] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    expect(out.outcome).toBe('failed')
    expect((out.result as { content: Array<{ text: string }> }).content[0].text).toMatch(/not more than one/)
    expect(rows.get(created.sessionId)?.tags).toEqual([])
    expect(envHost.setSessionTags).not.toHaveBeenCalled()
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('denies a remote session_tag from a live subagent before writing tags', async () => {
    vi.useFakeTimers()
    noteAcpTaskLifecycle('node-s', { type: 'task_started', taskId: 'sa-1', taskType: 'general-purpose' })
    const pending = desktopHostActionExecutor(
      claimed({ toolName: 'session_tag', sessionId: 'node-s', args: { add: ['oauth'] } }),
      new AbortController().signal,
      'conn-1',
    )
    await vi.advanceTimersByTimeAsync(PARENT_CALL_WAIT_MS)
    const out = await pending
    vi.useRealTimers()
    expect(out.outcome).toBe('failed')
    expect((out.result as { content: Array<{ text: string }> }).content[0].text).toMatch(/main thread/i)
    expect(envHost.setSessionTags).not.toHaveBeenCalled()
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
  })

  it('settles a node-only session without a desktop row or MCP call', async () => {
    const { runtime, rows } = nodeRuntime()
    const source = runtime.create({ projectId: 'p1', title: 'Current' })
    const target = runtime.create({ projectId: 'p1', title: 'Finished' })
    bindNodeRpc(runtime)

    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_cleanup',
        sessionId: source.sessionId,
        args: { action: 'settle', sessionIds: [target.sessionId] },
      }),
      new AbortController().signal,
      'conn-1',
    )

    expect(out.outcome).toBe('succeeded')
    expect(JSON.parse((out.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
      status: 'ok',
      action: 'settle',
      affected: [{ id: target.sessionId, title: 'Finished' }],
    })
    expect(rows.get(target.sessionId)?.isSettled).toBe(true)
    expect(rows.has(source.sessionId)).toBe(true)
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('deletes a node session only after the node confirm is accepted', async () => {
    const { runtime, rows } = nodeRuntime()
    const source = runtime.create({ projectId: 'p1', title: 'Current' })
    const target = runtime.create({ projectId: 'p1', title: 'Gone' })
    bindNodeRpc(runtime)

    const pending = desktopHostActionExecutor(
      claimed({
        toolName: 'session_cleanup',
        sessionId: source.sessionId,
        args: { action: 'delete', sessionIds: [target.sessionId] },
      }),
      new AbortController().signal,
      'conn-1',
    )
    let interaction = runtime.get(source.sessionId)?.pendingInteraction
    for (let i = 0; i < 50 && interaction?.kind !== 'session_cleanup_confirm'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      interaction = runtime.get(source.sessionId)?.pendingInteraction
    }
    expect(interaction?.kind).toBe('session_cleanup_confirm')
    runtime.respondPermission({
      sessionId: source.sessionId,
      interactionId: interaction!.interactionId,
      decision: 'allow',
      client: { clientSessionId: 'client-1' },
      leaseId: 'lease',
      generation: '1',
    })
    const out = await pending
    expect(out.outcome).toBe('succeeded')
    expect(JSON.parse((out.result as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
      status: 'ok',
      action: 'delete',
      deleted: [{ id: target.sessionId, title: 'Gone' }],
    })
    expect(rows.has(target.sessionId)).toBe(false)
    expect(rows.has(source.sessionId)).toBe(true)
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('stores a node-only session_rename on that node and refreshes the desktop list', async () => {
    const { runtime, rows, appended } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    appended.length = 0
    bindNodeRpc(runtime)
    renameTags.applyRenameTags.mockReturnValue({ error: `Session not found: ${created.sessionId}` })

    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_rename',
        sessionId: created.sessionId,
        args: { title: '排查远程节点 GPT 语音 404', tags: ['Bug', 'voice', 'remote-node'] },
      }),
      new AbortController().signal,
      'conn-1',
    )

    expect(out.outcome).toBe('succeeded')
    expect(out.result).toEqual({
      content: [{ type: 'text', text: 'Session renamed to "排查远程节点 GPT 语音 404". Tags: ["bug","voice","remote-node"].' }],
    })
    const saved = rows.get(created.sessionId)
    expect(saved).toMatchObject({
      title: '排查远程节点 GPT 语音 404',
      tags: ['bug', 'voice', 'remote-node'],
      isUserRenamed: false,
    })
    expect(appended.map((event) => event.eventType)).toEqual([
      SESSION_DURABLE_EVENT.tagsChanged,
      SESSION_DURABLE_EVENT.renamed,
    ])
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
    expect(mcpSurface.executeSuperoneMcpTool).not.toHaveBeenCalled()

    const frames = listFramesFor(runtime, appended)
    expect(frames.map((frame) => frame.events[0])).toEqual([
      { type: 'session_list_changed', projectPath: '/work/app' },
      { type: 'session_list_changed', projectPath: '/work/app' },
    ])
    const projects: Array<string | undefined> = []
    remoteListObserver('conn-1', new Map(), {
      sessionListChanged: (projectKey) => { projects.push(projectKey) },
      projectsChanged: () => {},
      activity: () => {},
    }).notice?.(frames[0] as never)
    expect(projects).toEqual(['remote:conn-1:/work/app'])
    await runtime.dispose()
  })

  it('keeps a user-locked node title and still stores tags on that node', async () => {
    const { runtime, rows, appended } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    runtime.rename(created.sessionId, '用户标题', 'user')
    appended.length = 0
    bindNodeRpc(runtime)
    renameTags.applyRenameTags.mockReturnValue({ error: `Session not found: ${created.sessionId}` })

    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_rename',
        sessionId: created.sessionId,
        args: { title: 'Agent try', tags: ['oauth'] },
      }),
      new AbortController().signal,
      'conn-1',
    )

    expect(out.outcome).toBe('failed')
    expect(out.result).toEqual({
      content: [{
        type: 'text',
        text: 'Error: user_locked. The user has manually set this session title. Do not call session_rename again for this session. Tags applied. Tags: ["oauth"].',
      }],
      isError: true,
    })
    expect(rows.get(created.sessionId)).toMatchObject({ title: '用户标题', tags: ['oauth'], isUserRenamed: true })
    expect(appended.map((event) => event.eventType)).toEqual([SESSION_DURABLE_EVENT.tagsChanged])
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('rejects an invalid remote tag before writing the node or the desktop archive', async () => {
    const { runtime, rows } = nodeRuntime()
    const created = runtime.create({ projectId: 'p1', title: '首条消息' })
    bindNodeRpc(runtime)

    const out = await desktopHostActionExecutor(
      claimed({
        toolName: 'session_rename',
        sessionId: created.sessionId,
        args: { title: 'Still the first line', tags: ['bad tag!'] },
      }),
      new AbortController().signal,
      'conn-1',
    )

    expect(out.outcome).toBe('failed')
    expect((out.result as { content: Array<{ text: string }> }).content[0]?.text).toMatch(/Invalid tag/)
    expect(rows.get(created.sessionId)).toMatchObject({ title: '首条消息', tags: [] })
    expect(envHost.setSessionTags).not.toHaveBeenCalled()
    expect(envHost.renameSession).not.toHaveBeenCalled()
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
    await runtime.dispose()
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
    expect(envHost.setSessionTags).not.toHaveBeenCalled()
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
    expect(envHost.setSessionTags).not.toHaveBeenCalled()
    expect(envHost.renameSession).not.toHaveBeenCalled()
  })

  it('stores tags on the node when remote rename is user_locked', async () => {
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
    expect(envHost.setSessionTags).toHaveBeenCalledWith('conn-1', 'node-s', { set: ['oauth'] })
    expect(renameTags.applyRenameTags).not.toHaveBeenCalled()
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
