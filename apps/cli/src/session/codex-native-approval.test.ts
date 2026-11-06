import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { SessionRuntime, type NodeSessionRecord, type SessionStore, type SessionEventLog } from '@superone/runtime/session'
import { createNodeCodexTurnRunner } from './codex-turn-runner'

const client = { clientSessionId: 'controller' }
const lease = { leaseId: 'lease', generation: '1' }
async function fixture(resume = false, voiceOnly = false) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-native-approval-'))
  const bin = join(dir, 'codex')
  writeFileSync(bin, '#!/bin/sh\n'); chmodSync(bin, 0o755)
  const events = new EventEmitter(), stdin = new PassThrough(), stdout = new PassThrough()
  const output: Array<Record<string, any>> = []
  const emit = (message: Record<string, unknown>) => { if (!stdout.writableEnded) stdout.write(`${JSON.stringify(message)}\n`) }
  const child = { stdin, stdout, stderr: new PassThrough(), killed: false,
    kill() { child.killed = true; stdout.end(); queueMicrotask(() => events.emit('exit', 0, null)); return true },
    on: events.on.bind(events), once: events.once.bind(events), emit: events.emit.bind(events) }
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      const message = JSON.parse(line); output.push(message)
      if (!message.method || message.id === undefined) continue
      if (message.method === 'thread/read') emit({ id: message.id, result: { thread: { id: message.params.threadId, source: { subAgent: { thread_spawn: { parent_thread_id: message.params.threadId === 'child' ? 'root' : 'foreign-root' } } } } } })
      else if (message.method === 'thread/start' || message.method === 'thread/resume') {
        emit({ id: message.id, result: { thread: { id: 'root' } } })
        if (resume) emit({ id: 'resumed', method: 'item/commandExecution/requestApproval', params: { threadId: 'root', turnId: 'old-turn', kind: 'humanCommand', command: 'git push', cwd: dir } })
      } else if (message.method === 'turn/start') emit({ id: message.id, result: { turn: { id: 'turn' } } })
      else emit({ id: message.id, result: {} })
    }
  })
  const runner = createNodeCodexTurnRunner({ binaryPath: bin, resolveProjectPath: () => dir, spawnFn: () => child as unknown as ChildProcessWithoutNullStreams })
  const rows = new Map<string, NodeSessionRecord>(), log: Array<{ eventType: string; payload: any }> = []
  const store: SessionStore = { loadAll: () => [], save: row => { rows.set(row.sessionId, structuredClone(row)) }, delete: id => { rows.delete(id) } }
  const eventLog: SessionEventLog = { headSequence: () => String(log.length), epoch: 'test', streaming: () => [], streamingAfter: () => [], onAppend: () => () => {}, listAfter: () => [], appendSession: event => { log.push(event) } }
  const runtime = new SessionRuntime(store, eventLog, { assertValid: input => { if (input.holderClientId !== client.clientSessionId || input.leaseId !== lease.leaseId || input.generation !== lease.generation) throw new Error('invalid lease') } }, 'node', runner)
  const session = runtime.create({ projectId: 'project', harnessId: 'codex' })
  if (resume) runtime.noteProviderResume(session.sessionId, 'root')
  if (voiceOnly) await runtime.codexVoice()!.open(runtime.get(session.sessionId)!)
  else {
    await runtime.send({ sessionId: session.sessionId, text: 'synthetic task', client, ...lease })
    await vi.waitFor(() => expect(output.some(message => message.method === 'turn/start')).toBe(true))
  }
  const pending = () => runtime.get(session.sessionId)?.pendingInteraction
  const approve = (decision: 'allow' | 'deny' | 'allow_always', options = {}) => runtime.respondPermission({ sessionId: session.sessionId, interactionId: pending()!.interactionId, decision, client, ...lease, ...options })
  const request = (id: string | number, kind = 'command', threadId = 'root') => emit({ id, method: 'item/commandExecution/requestApproval', params: { threadId, turnId: threadId === 'child' ? 'child-turn' : 'turn', kind, command: 'git push origin release', cwd: dir, itemId: 'execution', approvalId: 'checkpoint' } })
  const reply = (id: string | number) => output.find(message => message.id === id && !message.method)
  const complete = () => emit({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: 'completed' } } })
  const close = async () => { complete(); await vi.waitFor(() => expect(runtime.get(session.sessionId)?.status).not.toBe('streaming')); await runtime.dispose(); rmSync(dir, { recursive: true, force: true }) }
  return { runtime, session, output, log, rows, pending, approve, request, emit, reply, complete, disconnect: () => child.kill(), close }
}

describe('remote native approval round trip', () => {
  it('advertises support and keeps session grants owned by Codex', async () => {
    const f = await fixture()
    try {
      expect(f.output.find(message => message.method === 'initialize')!.params.capabilities.requiredHumanApproval).toBe(true)
      f.request(0)
      await vi.waitFor(() => expect(f.pending()?.input?.command).toBe('git push origin release'))
      expect(f.rows.get(f.session.sessionId)?.pendingInteraction).toMatchObject({ toolName: 'Bash', allowAlwaysAllow: true })
      expect(() => f.approve('allow', { client: { clientSessionId: 'observer' } })).toThrow('invalid lease')
      expect(() => f.approve('allow', { generation: 'stale' })).toThrow('invalid lease')
      f.approve('allow_always')
      await vi.waitFor(() => expect(f.reply(0)?.result).toEqual({ decision: 'acceptForSession' }))
      expect(f.runtime.get(f.session.sessionId)?.alwaysAllowedTools).toEqual([])
      expect(() => f.approve('allow')).toThrow()
    } finally { await f.close() }
  })
  it.each(['allow', 'deny', 'cancel'] as const)('requires a fresh human %s decision for a checkpoint', async decision => {
    const f = await fixture()
    try {
      f.request('human', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      expect(f.pending()?.allowAlwaysAllow).toBe(false)
      expect(() => f.approve('allow_always')).toThrow(/once/)
      f.approve(decision === 'allow' ? 'allow' : 'deny', { cancel: decision === 'cancel' })
      await vi.waitFor(() => expect(f.reply('human')?.result).toEqual({ decision: decision === 'allow' ? 'accept' : decision === 'deny' ? 'decline' : 'cancel' }))
    } finally { await f.close() }
  })
  it('clears provider-resolved prompts, deduplicates replay and ignores late clicks', async () => {
    const f = await fixture()
    try {
      f.request('ended', 'humanCommand'); f.request('ended', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      const id = f.pending()!.interactionId
      expect(f.log.filter(event => event.eventType === 'session.permission_requested')).toHaveLength(1)
      f.emit({ method: 'serverRequest/resolved', params: { threadId: 'root', requestId: 'ended' } })
      await vi.waitFor(() => expect(f.pending()).toBeNull())
      expect(f.reply('ended')).toBeUndefined()
      expect(() => f.runtime.respondPermission({ sessionId: f.session.sessionId, interactionId: id, decision: 'allow', client, ...lease })).toThrow(/no matching/)
    } finally { await f.close() }
  })
  it('routes verified descendants after the root turn ends and rejects unrelated threads', async () => {
    const f = await fixture()
    try {
      f.complete()
      await vi.waitFor(() => expect(f.runtime.get(f.session.sessionId)?.status).toBe('idle'))
      f.request('child-request', 'humanCommand', 'child')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('child-request')?.result).toEqual({ decision: 'accept' }))
      f.request('foreign-request', 'humanCommand', 'foreign')
      await vi.waitFor(() => expect(f.reply('foreign-request')?.result).toEqual({ decision: 'decline' }))
      expect(f.pending()).toBeNull()
    } finally { await f.close() }
  })
  it('serializes native prompts without replacing the first pending decision', async () => {
    const f = await fixture()
    try {
      f.request('first', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      const first = f.pending()!.interactionId
      f.request('second', 'humanCommand', 'child')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(f.pending()?.interactionId).toBe(first)
      f.approve('allow')
      await vi.waitFor(() => expect(f.pending()?.interactionId).not.toBe(first))
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.approve('deny')
      await vi.waitFor(() => expect(f.reply('second')?.result).toEqual({ decision: 'decline' }))
      expect(f.reply('first')?.result).toEqual({ decision: 'accept' })
    } finally { await f.close() }
  })
  it('cancels an approval when its turn completes without clearing a different child turn', async () => {
    const f = await fixture()
    try {
      f.request('root-ended', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.complete()
      await vi.waitFor(() => expect(f.pending()).toBeNull())
      expect(f.reply('root-ended')).toBeUndefined()
      f.request('child-live', 'humanCommand', 'child')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.complete()
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(f.pending()?.requiresHumanApproval).toBe(true)
      f.approve('deny')
      await vi.waitFor(() => expect(f.reply('child-live')?.result).toEqual({ decision: 'decline' }))
    } finally { await f.close() }
  })
  it('routes file and destination-specific network approvals through the same lease gate', async () => {
    const f = await fixture()
    try {
      f.emit({ id: 'file', method: 'item/fileChange/requestApproval', params: { threadId: 'root', turnId: 'turn', grantRoot: '/work/reference', reason: 'Edit reference' } })
      await vi.waitFor(() => expect(f.pending()?.toolName).toBe('FileChange'))
      expect(f.pending()?.input?.file_path).toBe('/work/reference')
      f.approve('deny')
      await vi.waitFor(() => expect(f.reply('file')?.result).toEqual({ decision: 'decline' }))
      f.emit({ id: 'network', method: 'item/commandExecution/requestApproval', params: { threadId: 'root', turnId: 'turn', networkApprovalContext: { host: 'example.org', protocol: 'https' } } })
      await vi.waitFor(() => expect(f.pending()?.toolName).toBe('SandboxNetworkAccess'))
      expect(f.pending()?.input?.host).toBe('example.org')
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('network')?.result).toEqual({ decision: 'accept' }))
    } finally { await f.close() }
  })
  it('routes native decisions for a voice-opened session before its first text turn', async () => {
    const f = await fixture(false, true)
    try {
      expect(f.output.find(message => message.method === 'initialize')!.params.capabilities.requiredHumanApproval).toBe(true)
      f.request('voice-checkpoint', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('voice-checkpoint')?.result).toEqual({ decision: 'accept' }))
    } finally { await f.close() }
  })
  it('aborts the persisted native prompt when the app-server disconnects', async () => {
    const f = await fixture()
    try {
      f.request('disconnected', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.disconnect()
      await vi.waitFor(() => expect(f.pending()).toBeNull())
      expect(f.reply('disconnected')).toBeUndefined()
    } finally { await f.close() }
  })
  it.each([false, true])('Stop cancels active and queued approvals with idle=%s', async idle => {
    const f = await fixture()
    try {
      if (idle) { f.complete(); await vi.waitFor(() => expect(f.runtime.get(f.session.sessionId)?.status).toBe('idle')) }
      f.request('stopped', 'humanCommand', idle ? 'child' : 'root')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.request('queued-stop', 'humanCommand', 'child')
      await vi.waitFor(() => expect(f.output.some(message => message.method === 'thread/read' && message.params.threadId === 'child')).toBe(true))
      f.runtime.interrupt(f.session.sessionId, client, lease.leaseId, lease.generation)
      await vi.waitFor(() => expect(f.pending()).toBeNull())
      await vi.waitFor(() => expect(f.reply('queued-stop')?.result).toEqual({ decision: 'cancel' }))
      expect(f.log.filter(event => event.eventType === 'session.permission_requested')).toHaveLength(1)
    } finally { await f.close() }
  })
  it.each([false, true])('queues MCP and native interactions without cancelling either with MCP first=%s', async mcpFirst => {
    const f = await fixture()
    const form = () => f.emit({ id: 'mcp-mixed', method: 'mcpServer/elicitation/request', params: { threadId: 'root', turnId: 'turn', serverName: 'fixture', mode: 'form', message: 'Continue?', requestedSchema: { type: 'object', properties: {} } } })
    try {
      if (mcpFirst) form(); else f.request('native-mixed', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()).not.toBeNull())
      const first = f.pending()!.interactionId
      if (mcpFirst) f.request('native-mixed', 'humanCommand'); else form()
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(f.pending()?.interactionId).toBe(first)
      expect(f.reply(mcpFirst ? 'mcp-mixed' : 'native-mixed')).toBeUndefined()
      f.approve('allow')
      await vi.waitFor(() => expect(f.pending()?.interactionId).not.toBe(first))
      await vi.waitFor(() => expect(f.pending()).not.toBeNull())
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('native-mixed')?.result).toEqual({ decision: 'accept' }))
      await vi.waitFor(() => expect(f.reply('mcp-mixed')?.result).toMatchObject({ action: 'accept' }))
      expect(f.log.filter(event => event.eventType === 'session.permission_aborted')).toHaveLength(0)
    } finally { await f.close() }
  })
  it('allows a new voice-only approval after Stop without a text turn', async () => {
    const f = await fixture(false, true)
    try {
      f.request('before-stop', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.runtime.interrupt(f.session.sessionId, client, lease.leaseId, lease.generation)
      await vi.waitFor(() => expect(f.pending()).toBeNull())
      f.request('after-stop', 'humanCommand')
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('after-stop')?.result).toEqual({ decision: 'accept' }))
    } finally { await f.close() }
  })
  it('handles checkpoint replay during thread resume before thread identity is returned', async () => {
    const f = await fixture(true)
    try {
      await vi.waitFor(() => expect(f.pending()?.requiresHumanApproval).toBe(true))
      f.approve('allow')
      await vi.waitFor(() => expect(f.reply('resumed')?.result).toEqual({ decision: 'accept' }))
    } finally { await f.close() }
  })
})
