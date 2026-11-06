import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { ControlLease } from '@superone/shared/environment'
import { startNodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

it('confirms Stop only after cleanup and replays a lost receipt without interrupting the next turn', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stop-node-'))
  const project = mkdtempSync(join(tmpdir(), 'stop-project-'))
  const turns: Array<{ signal: AbortSignal; finish: () => void }> = []
  const runtime = await startNodeRuntime({
    nodeHome: home, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true,
    turnRunner: async ({ signal, onDelta, onInputAccepted }) => {
      onInputAccepted?.()
      onDelta('Working')
      await new Promise<void>(resolve => { turns.push({ signal, finish: resolve }) })
      return { finalText: 'done' }
    },
  })
  const client = await connectAuthedRpc(runtime)
  try {
    const { projectId } = await client.rpc('project.open', { path: project }) as { projectId: string }
    const { sessionId } = await client.rpc('session.create', { projectId, harnessId: 'claude' }) as { sessionId: string }
    const { leaseId, generation } = await client.rpc('session.acquireControl', { sessionId }) as ControlLease
    const control = { sessionId, leaseId, generation }
    await client.rpc('session.send', { ...control, text: 'first', clientMessageId: 'first' })
    await vi.waitFor(() => expect(turns).toHaveLength(1))
    const key = crypto.randomUUID()
    let replied = false
    const stop = client.rpc('session.interrupt', control, key).then(result => { replied = true; return result })
    await vi.waitFor(() => expect(turns[0].signal.aborted).toBe(true))
    expect(replied).toBe(false)
    await expect(client.rpc('session.send', { ...control, text: 'too soon' })).rejects.toMatchObject({ code: 'failed_precondition' })
    turns[0].finish()
    expect(await stop).toEqual({ ok: true, status: 'stopped' })
    expect(runtime.sessions.get(sessionId)?.status).toBe('interrupted')
    await client.rpc('session.send', { ...control, text: 'second', clientMessageId: 'second' })
    await vi.waitFor(() => expect(turns).toHaveLength(2))
    // Reconnect/resend uses the original command key even after a later turn starts.
    expect(await client.rpc('session.interrupt', control, key)).toEqual({ ok: true, status: 'stopped' })
    expect(turns[1].signal.aborted).toBe(false)
  } finally {
    turns.forEach(turn => turn.finish())
    client.close()
    await runtime.stop()
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
