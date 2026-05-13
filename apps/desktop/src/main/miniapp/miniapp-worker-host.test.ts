import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHeadlessTool } from './miniapp-worker-host'
import { subscribePeer, _resetAllForTests } from './miniapp-peer-bus'

let workdir: string

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'superone-headless-test-'))
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function writeService(name: string, content: string): string {
  const path = join(workdir, name)
  writeFileSync(path, content)
  return path
}

describe('executeHeadlessTool', () => {
  it('spawns worker, calls handler, returns result, terminates', async () => {
    const service = writeService(
      'basic.mjs',
      `superone.tools.handle('echo', (args) => ({ ok: true, args }))`,
    )
    const result = await executeHeadlessTool({
      sessionId: 's1',
      appId: 'test',
      headlessEntry: service,
      toolName: 'echo',
      args: { x: 42 },
    })
    expect(result).toEqual({ ok: true, args: { x: 42 } })
  })

  it('supports async handlers', async () => {
    const service = writeService(
      'async.mjs',
      `superone.tools.handle('delayed', async (args) => {
        await new Promise((r) => setTimeout(r, 10))
        return { value: args.n * 2 }
      })`,
    )
    const result = await executeHeadlessTool({
      sessionId: 's1',
      appId: 'test',
      headlessEntry: service,
      toolName: 'delayed',
      args: { n: 21 },
    })
    expect(result).toEqual({ value: 42 })
  })

  it('reports error when handler throws', async () => {
    const service = writeService(
      'throws.mjs',
      `superone.tools.handle('boom', () => { throw new Error('kaboom') })`,
    )
    await expect(
      executeHeadlessTool({
        sessionId: 's1',
        appId: 'test',
        headlessEntry: service,
        toolName: 'boom',
        args: {},
      }),
    ).rejects.toThrow(/kaboom/)
  })

  it('reports error when tool name not registered', async () => {
    const service = writeService('emptyreg.mjs', `// no tools registered`)
    await expect(
      executeHeadlessTool({
        sessionId: 's1',
        appId: 'test',
        headlessEntry: service,
        toolName: 'missing',
        args: {},
      }),
    ).rejects.toThrow(/not registered/)
  })

  it('times out long-running handler', async () => {
    const service = writeService(
      'slow.mjs',
      `superone.tools.handle('slow', async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return 'done'
      })`,
    )
    await expect(
      executeHeadlessTool({
        sessionId: 's1',
        appId: 'test',
        headlessEntry: service,
        toolName: 'slow',
        args: {},
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out/)
  })

  it('reports bootstrap error when service.mjs throws on import', async () => {
    const service = writeService('badimport.mjs', `throw new Error('init failed')`)
    await expect(
      executeHeadlessTool({
        sessionId: 's1',
        appId: 'test',
        headlessEntry: service,
        toolName: 'whatever',
        args: {},
      }),
    ).rejects.toThrow(/init failed/)
  })

  it('peer.emit messages do not interfere with result delivery', async () => {
    const service = writeService(
      'peer.mjs',
      `superone.tools.handle('with-progress', () => {
        superone.peer.emit('progress', { pct: 50 })
        superone.peer.emit('progress', { pct: 100 })
        return { done: true }
      })`,
    )
    const result = await executeHeadlessTool({
      sessionId: 's1',
      appId: 'test',
      headlessEntry: service,
      toolName: 'with-progress',
      args: {},
    })
    expect(result).toEqual({ done: true })
  })

  it('routes peer.emit through peer-bus to subscribers', async () => {
    _resetAllForTests()
    const service = writeService(
      'peer-bus.mjs',
      `superone.tools.handle('progress-emitter', () => {
        superone.peer.emit('progress', { pct: 25 })
        superone.peer.emit('progress', { pct: 75 })
        superone.peer.emit('done', { ok: true })
        return { finished: true }
      })`,
    )
    const events: Array<{ event: string; payload: unknown }> = []
    subscribePeer('s1', 'peerapp', (event, payload) => events.push({ event, payload }))

    const result = await executeHeadlessTool({
      sessionId: 's1',
      appId: 'peerapp',
      headlessEntry: service,
      toolName: 'progress-emitter',
      args: {},
    })

    expect(result).toEqual({ finished: true })
    expect(events).toEqual([
      { event: 'progress', payload: { pct: 25 } },
      { event: 'progress', payload: { pct: 75 } },
      { event: 'done', payload: { ok: true } },
    ])
  })

  it('peer events do not leak to subscribers of a different appId', async () => {
    _resetAllForTests()
    const service = writeService(
      'peer-leak.mjs',
      `superone.tools.handle('emit', () => {
        superone.peer.emit('signal', null)
        return 'ok'
      })`,
    )
    const wrongAppListener = vi.fn()
    subscribePeer('s1', 'otherApp', wrongAppListener)

    await executeHeadlessTool({
      sessionId: 's1',
      appId: 'targetApp',
      headlessEntry: service,
      toolName: 'emit',
      args: {},
    })

    expect(wrongAppListener).not.toHaveBeenCalled()
  })

  it('isolates two sequential calls to same app', async () => {
    const service = writeService(
      'isolate.mjs',
      `let counter = 0
       superone.tools.handle('inc', () => ({ counter: ++counter }))`,
    )
    const a = await executeHeadlessTool({
      sessionId: 's1', appId: 'test', headlessEntry: service, toolName: 'inc', args: {},
    })
    const b = await executeHeadlessTool({
      sessionId: 's1', appId: 'test', headlessEntry: service, toolName: 'inc', args: {},
    })
    // Each spawn is a fresh worker → counter resets
    expect(a).toEqual({ counter: 1 })
    expect(b).toEqual({ counter: 1 })
  })
})
