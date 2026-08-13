import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({ spawn }))
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { setAcpKillEscalateMsForTests, spawnAcpProcess } from './acp-process'

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  ignoreTerm: boolean
  kill: (signal?: NodeJS.Signals) => boolean
}

function fakeChild(ignoreTerm: boolean): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.ignoreTerm = ignoreTerm
  child.kill = (signal?: NodeJS.Signals) => {
    if (signal === 'SIGTERM' && child.ignoreTerm) return true
    child.signalCode = signal ?? 'SIGTERM'
    queueMicrotask(() => child.emit('exit', null, child.signalCode))
    return true
  }
  return child
}

describe('spawnAcpProcess kill escalation', () => {
  afterEach(() => {
    setAcpKillEscalateMsForTests(null)
    spawn.mockReset()
  })

  it('escalates to SIGKILL when the agent ignores SIGTERM', async () => {
    setAcpKillEscalateMsForTests(1)
    const child = fakeChild(true)
    spawn.mockReturnValue(child)
    const handle = spawnAcpProcess({
      agentId: 'test',
      command: 'acp',
      args: [],
      env: {},
      cwd: process.cwd(),
    })
    const closed = handle.closed
    await handle.kill()
    const info = await closed
    expect(info.signal).toBe('SIGKILL')
  })

  it('stops on SIGTERM when the agent exits cleanly', async () => {
    const child = fakeChild(false)
    spawn.mockReturnValue(child)
    const handle = spawnAcpProcess({
      agentId: 'test',
      command: 'acp',
      args: [],
      env: {},
      cwd: process.cwd(),
    })
    const closed = handle.closed
    await handle.kill()
    const info = await closed
    expect(info.signal).toBe('SIGTERM')
  })
})
