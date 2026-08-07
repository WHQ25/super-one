import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { SshTunnelSpec } from '@superone/shared/environment'
import { isSshProcessAlive, SshTunnelManager, type ForwardStarter } from './ssh-tunnel-manager'
import type { SshForwardHandle } from './ssh-forward'

function fakeProcess(opts: {
  killed?: boolean
  exitCode?: number | null
  signalCode?: NodeJS.Signals | null
}): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess & EventEmitter
  Object.defineProperty(emitter, 'killed', { value: opts.killed ?? false, writable: true })
  Object.defineProperty(emitter, 'exitCode', {
    value: opts.exitCode === undefined ? null : opts.exitCode,
    writable: true,
  })
  Object.defineProperty(emitter, 'signalCode', {
    value: opts.signalCode === undefined ? null : opts.signalCode,
    writable: true,
  })
  return emitter
}

function handleFor(
  process: ChildProcess,
  localBaseUrl: string,
  stop = vi.fn(),
): SshForwardHandle {
  return {
    localPort: Number(new URL(localBaseUrl).port),
    localBaseUrl,
    process,
    stop,
  }
}

const baseSpec: SshTunnelSpec = {
  destination: 'user@host',
  remotePort: 7788,
}

describe('isSshProcessAlive', () => {
  it('is false when the process exited on its own (killed stays false)', () => {
    expect(
      isSshProcessAlive(fakeProcess({ killed: false, exitCode: 255, signalCode: null })),
    ).toBe(false)
  })

  it('is true for a still-running process', () => {
    expect(isSshProcessAlive(fakeProcess({ killed: false, exitCode: null, signalCode: null }))).toBe(
      true,
    )
  })
})

describe('SshTunnelManager', () => {
  it('reuses a truly live process with the same spec', async () => {
    const proc = fakeProcess({})
    const stop = vi.fn()
    const starter: ForwardStarter = vi.fn(async () =>
      handleFor(proc, 'http://127.0.0.1:40001', stop),
    )
    const manager = new SshTunnelManager(starter)

    const a = await manager.ensure('c1', baseSpec)
    const b = await manager.ensure('c1', baseSpec)
    expect(a).toBe('http://127.0.0.1:40001')
    expect(b).toBe(a)
    expect(starter).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when exitCode is set while killed is still false', async () => {
    const dead = fakeProcess({ killed: false, exitCode: 1 })
    const live = fakeProcess({})
    const starter: ForwardStarter = vi
      .fn()
      .mockResolvedValueOnce(handleFor(dead, 'http://127.0.0.1:40001'))
      .mockResolvedValueOnce(handleFor(live, 'http://127.0.0.1:40002'))
    const manager = new SshTunnelManager(starter)

    expect(await manager.ensure('c1', baseSpec)).toBe('http://127.0.0.1:40001')
    expect(await manager.ensure('c1', baseSpec)).toBe('http://127.0.0.1:40002')
    expect(starter).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent ensure calls', async () => {
    let resolveStarter!: (h: SshForwardHandle) => void
    const starter: ForwardStarter = vi.fn(
      () =>
        new Promise<SshForwardHandle>((resolve) => {
          resolveStarter = resolve
        }),
    )
    const manager = new SshTunnelManager(starter)
    const p1 = manager.ensure('c1', baseSpec)
    const p2 = manager.ensure('c1', baseSpec)
    expect(starter).toHaveBeenCalledTimes(1)
    resolveStarter(handleFor(fakeProcess({}), 'http://127.0.0.1:40003'))
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      'http://127.0.0.1:40003',
      'http://127.0.0.1:40003',
    ])
  })

  it('drops late starter results after close and stops the handle', async () => {
    let resolveStarter!: (h: SshForwardHandle) => void
    const stop = vi.fn()
    const starter: ForwardStarter = vi.fn(
      () =>
        new Promise<SshForwardHandle>((resolve) => {
          resolveStarter = resolve
        }),
    )
    const manager = new SshTunnelManager(starter)
    const pending = manager.ensure('c1', baseSpec)
    manager.close('c1')
    resolveStarter(handleFor(fakeProcess({}), 'http://127.0.0.1:40004', stop))
    await expect(pending).rejects.toThrow(/aborted/)
    expect(stop).toHaveBeenCalled()
    expect(manager.has('c1')).toBe(false)
  })

  it('removes map entry when the process emits exit', async () => {
    const proc = fakeProcess({})
    const starter: ForwardStarter = vi.fn(async () =>
      handleFor(proc, 'http://127.0.0.1:40005'),
    )
    const manager = new SshTunnelManager(starter)
    await manager.ensure('c1', baseSpec)
    expect(manager.has('c1')).toBe(true)
    proc.emit('exit', 1, null)
    expect(manager.has('c1')).toBe(false)
  })

  it('closeAll aborts inflight-only ensure and does not store the late handle', async () => {
    let resolveStarter!: (h: SshForwardHandle) => void
    const stop = vi.fn()
    const starter: ForwardStarter = vi.fn(
      () =>
        new Promise<SshForwardHandle>((resolve) => {
          resolveStarter = resolve
        }),
    )
    const manager = new SshTunnelManager(starter)
    const pending = manager.ensure('c1', baseSpec)
    // No live entry yet — only inflight. closeAll must still invalidate.
    expect(manager.has('c1')).toBe(false)
    manager.closeAll()
    resolveStarter(handleFor(fakeProcess({}), 'http://127.0.0.1:40006', stop))
    await expect(pending).rejects.toThrow(/aborted/)
    expect(stop).toHaveBeenCalled()
    expect(manager.has('c1')).toBe(false)
  })

  it('close then ensure starts a fresh starter (does not reuse doomed inflight)', async () => {
    let resolveFirst!: (h: SshForwardHandle) => void
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const starter: ForwardStarter = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SshForwardHandle>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(handleFor(fakeProcess({}), 'http://127.0.0.1:40008', secondStop))

    const manager = new SshTunnelManager(starter)
    const first = manager.ensure('c1', baseSpec)
    manager.close('c1')
    const second = manager.ensure('c1', baseSpec)
    resolveFirst(handleFor(fakeProcess({}), 'http://127.0.0.1:40007', firstStop))
    await expect(first).rejects.toThrow(/aborted/)
    expect(firstStop).toHaveBeenCalled()
    await expect(second).resolves.toBe('http://127.0.0.1:40008')
    expect(manager.has('c1')).toBe(true)
    expect(starter).toHaveBeenCalledTimes(2)
  })

  it('adopt invalidates a pending ensure so late starter cannot overwrite', async () => {
    let resolveStarter!: (h: SshForwardHandle) => void
    const lateStop = vi.fn()
    const starter: ForwardStarter = vi.fn(
      () =>
        new Promise<SshForwardHandle>((resolve) => {
          resolveStarter = resolve
        }),
    )
    const manager = new SshTunnelManager(starter)
    const pending = manager.ensure('c1', baseSpec)
    const adopted = handleFor(fakeProcess({}), 'http://127.0.0.1:40009')
    manager.adopt('c1', adopted, baseSpec)
    expect(manager.baseUrl('c1')).toBe('http://127.0.0.1:40009')
    resolveStarter(handleFor(fakeProcess({}), 'http://127.0.0.1:40010', lateStop))
    await expect(pending).rejects.toThrow(/aborted/)
    expect(lateStop).toHaveBeenCalled()
    expect(manager.baseUrl('c1')).toBe('http://127.0.0.1:40009')
  })
})
