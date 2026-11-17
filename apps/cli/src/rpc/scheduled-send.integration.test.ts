import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const homes: string[] = []
let node: NodeRuntime | undefined

afterEach(async () => {
  await node?.stop()
  node = undefined
  vi.useRealTimers()
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('arms, edits and cancels through controlled RPC and delivers once after a disconnected restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'scheduled-node-'))
  homes.push(home)
  const turns: unknown[] = []
  const boot = () => startNodeRuntime({
    nodeHome: home, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true,
    turnRunner: async ({ text, images }) => { turns.push({ text, images }); return { finalText: 'ok' } },
  })
  node = await boot()
  const client = await connectAuthedRpc(node)
  const descriptor = await client.rpc('environment.descriptor') as ExecutionEnvironmentDescriptor
  expect(descriptor.capabilities.methods).toEqual(expect.arrayContaining([
    'session.scheduledSend.get', 'session.scheduledSend.set', 'session.scheduledSend.clear', 'sessionList.scheduledSends',
  ]))
  const { projectId } = await client.rpc('project.open', { path: home }) as { projectId: string }
  const { sessionId } = await client.rpc('session.create', { projectId, harnessId: 'codex' }) as { sessionId: string }
  const lease = await client.rpc('session.acquireControl', { sessionId }) as { leaseId: string; generation: string }
  const sendAt = Date.now() + 60_000
  const patch = { armed: true, sendAt, message: 'first draft' }
  await expect(client.rpc('session.scheduledSend.set', { sessionId, patch })).rejects.toThrow()
  const target = { sessionId, ...lease }
  const set = (patch: object) => client.rpc('session.scheduledSend.set', { ...target, patch })
  const frames: unknown[] = []
  client.onMessage(frame => { if (frame.type === 'topic') frames.push(frame.frame) })
  await client.rpc('topic.subscribe', { subscriptionId: 'schedules', topics: [{ kind: 'sessionList', environmentId: client.environmentId }],
    afterSequence: '0', versions: {} })
  await set(patch)
  expect(frames).toContainEqual(expect.objectContaining({ events: [expect.objectContaining({ sessionId, type: 'scheduled_send_changed',
    scheduled: expect.objectContaining(patch), delivered: false })] }))
  expect(await client.rpc('sessionList.scheduledSends')).toEqual([expect.objectContaining({ sessionId, ...patch })])
  await client.rpc('session.scheduledSend.clear', target)
  expect(await client.rpc('session.scheduledSend.get', { sessionId })).toBeNull()
  const image = { name: 'one.png', mimeType: 'image/png', base64: 'AQID' }
  await expect(set({ ...patch, attachments: [{ ...image, originalPath: join(home, 'outside.png') }] })).rejects.toThrow(/attachment/)
  await set({ ...patch, attachments: [image] })
  // Arm for the near future and stop the node before it is due.
  const due = sendAt + 60_000
  await set({ message: 'edited draft', sendAt: due })
  client.close()
  await node.stop()
  node = undefined
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(due + 1)
  node = await boot()
  await vi.waitFor(() => expect(turns).toEqual([{ text: 'edited draft', images: [image] }]), { timeout: 5000 })
  const after = await connectAuthedRpc(node)
  expect(await after.rpc('session.scheduledSend.get', { sessionId })).toBeNull()
  expect(await after.rpc('sessionList.scheduledSends')).toEqual([])
  expect(node.sessions.messages(sessionId).filter(message => message.role === 'user')).toHaveLength(1)
  after.close()
})

it('offers a quota reset on the node and keeps an accepted continuation armed for the next reset', async () => {
  const home = mkdtempSync(join(tmpdir(), 'scheduled-reset-'))
  homes.push(home)
  const resetsAt = Math.ceil(Date.now() / 1000) + 3600
  node = await startNodeRuntime({
    nodeHome: home, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true,
    turnRunner: async ({ onAgentEvent }) => {
      onAgentEvent?.({ type: 'message_error', messageId: 'error', error: 'quota',
        errorInfo: { code: 'rate_limit', raw: 'quota', resetsAt } })
      throw new Error('quota')
    },
  })
  const session = node.sessions.create({ projectId: 'p', harnessId: 'claude' })
  const { sessionId } = session
  await node.sessions.sendWithoutLease({ sessionId, text: 'start' })
  const schedules = node.sessions.scheduledSends
  await vi.waitFor(() => expect(schedules.get(sessionId)).toMatchObject({ armed: false, source: 'rate_limit' }))
  schedules.set(sessionId, { armed: true, sendAt: Date.now(), message: 'resume' })
  await vi.waitFor(() => expect(schedules.get(sessionId)).toMatchObject({
    armed: true, source: 'rate_limit', sendAt: resetsAt * 1000 + 60_000, message: 'resume',
  }))
})

it('waits for an active turn and deduplicates a recovered schedule against the durable transcript', async () => {
  const home = mkdtempSync(join(tmpdir(), 'scheduled-busy-'))
  homes.push(home)
  const gate = Promise.withResolvers<void>()
  const texts: string[] = []
  const boot = () => startNodeRuntime({
    nodeHome: home, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true,
    turnRunner: async ({ text }) => {
      texts.push(text)
      if (text === 'in progress') await gate.promise
      return { finalText: 'done' }
    },
  })
  node = await boot()
  const { sessionId } = node.sessions.create({ projectId: 'p', harnessId: 'codex' })
  try {
    await node.sessions.sendWithoutLease({ sessionId, text: 'in progress' })
    node.sessions.scheduledSends.set(sessionId, { armed: true, message: 'later', sendAt: Date.now() + 60_000 })
    node.sessions.scheduledSends.set(sessionId, { sendAt: Date.now() })
    node.db.exec('CREATE TEMP TABLE before_delivery AS SELECT * FROM scheduled_sends')
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(texts).toEqual(['in progress'])
  } finally { gate.resolve() }
  await vi.waitFor(() => expect(node!.sessions.scheduledSends.get(sessionId)).toBeNull())
  expect(texts).toEqual(['in progress', 'later'])
  // Recover as if the process stopped after accepting the message but before retiring the due row.
  node.db.exec('INSERT INTO scheduled_sends SELECT * FROM before_delivery')
  await node.stop()
  node = undefined
  node = await boot()
  await vi.waitFor(() => expect(node!.sessions.scheduledSends.get(sessionId)).toBeNull())
  expect(texts).toEqual(['in progress', 'later'])
  expect(node.sessions.messages(sessionId).filter(message => message.role === 'user')).toHaveLength(2)
})
