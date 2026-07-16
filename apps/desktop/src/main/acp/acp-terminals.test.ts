import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpTerminalManager } from './acp-terminals'

describe('AcpTerminalManager', () => {
  let root: string
  let mgr: AcpTerminalManager

  afterEach(async () => {
    mgr?.dispose()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('creates, captures output, and waits for exit', async () => {
    root = await mkdtemp(join(tmpdir(), 'acp-term-'))
    mgr = new AcpTerminalManager({ projectPath: root })
    const { terminalId } = mgr.create({
      sessionId: 's1',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("hello-acp")'],
      cwd: root,
    })
    const exit = await mgr.waitForExit({ sessionId: 's1', terminalId })
    expect(exit.exitCode).toBe(0)
    const out = mgr.output({ sessionId: 's1', terminalId })
    expect(out.output).toContain('hello-acp')
    expect(out.truncated).toBe(false)
    expect(out.exitStatus?.exitCode).toBe(0)
  })

  it('binds toolUseId and emits output listener', async () => {
    root = await mkdtemp(join(tmpdir(), 'acp-term-'))
    const events: Array<{ toolUseId?: string; content: string; finished: boolean }> = []
    mgr = new AcpTerminalManager({
      projectPath: root,
      onOutput: (e) => events.push(e),
    })
    const { terminalId } = mgr.create({
      sessionId: 's1',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("bound")'],
    })
    mgr.bindTool(terminalId, 'tu-1')
    await mgr.waitForExit({ sessionId: 's1', terminalId })
    expect(events.some((e) => e.toolUseId === 'tu-1' && e.content.includes('bound'))).toBe(true)
    expect(events.some((e) => e.finished)).toBe(true)
  })

  it('rejects cwd outside roots', () => {
    mgr = new AcpTerminalManager({ projectPath: '/tmp/acp-only-root-xyz' })
    expect(() => mgr.create({
      sessionId: 's1',
      command: 'echo',
      args: ['x'],
      cwd: '/etc',
    })).toThrow(/cwd outside/)
  })

  it('release invalidates terminal id', async () => {
    root = await mkdtemp(join(tmpdir(), 'acp-term-'))
    mgr = new AcpTerminalManager({ projectPath: root })
    const { terminalId } = mgr.create({
      sessionId: 's1',
      command: process.execPath,
      args: ['-e', 'setTimeout(()=>{}, 5000)'],
    })
    mgr.release({ sessionId: 's1', terminalId })
    expect(() => mgr.output({ sessionId: 's1', terminalId })).toThrow(/Unknown terminal/)
  })
})
