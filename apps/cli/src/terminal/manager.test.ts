import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { ControlLeaseService } from '@superone/runtime/lease'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { NodeTerminalManager } from './manager'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function freshDb(): { db: NodeDatabase; prepared: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'sroe-terminal-'))
  dirs.push(dir)
  const real = openNodeDatabase(join(dir, 'state.db'))
  const prepared: string[] = []
  const db = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          prepared.push(sql)
          return target.prepare(sql)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as NodeDatabase
  return { db, prepared }
}

/** node-pty delivers onExit asynchronously; wait for it to land. */
async function settlePtyExit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400))
}

describe('NodeTerminalManager exit bookkeeping', () => {
  it('publishes native output and control hints with an attach sequence and releases control on kill', async () => {
    const { db } = freshDb()
    const terminals = new NodeTerminalManager(db)
    const leases = new ControlLeaseService(db)
    terminals.bindLeases('env', leases)
    const events: TerminalEvent[] = []
    const off = terminals.onEvent(event => events.push(event))
    const dir = mkdtempSync(join(tmpdir(), 'sroe-terminal-native-'))
    dirs.push(dir)
    const info = terminals.create({ cwd: dir, shell: '/bin/sh' })
    const resource = { environmentId: 'env', terminalId: info.terminalId }
    leases.acquire({ resource, holderClientId: 'controller', ttlMs: 60_000 })
    expect(terminals.attach(info.terminalId, 'controller').terminal.writableByMe).toBe(true)
    expect(terminals.attach(info.terminalId, 'observer').terminal.writableByMe).toBe(false)
    terminals.write(info.terminalId, "printf 'native marker\\n'\n")
    await vi.waitFor(() => expect(events.some(event => event.type === 'terminal_output')).toBe(true))
    const attach = terminals.attach(info.terminalId, 'controller')
    expect(attach.terminal.lastSeq).toBe(Number(attach.sequence))
    expect(terminals.readAfter(info.terminalId, attach.sequence).data).toBe('')
    expect(events).toContainEqual(expect.objectContaining({ type: 'terminal_created', terminalId: info.terminalId }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'terminal_owner_changed', ownerDeviceId: 'controller' }))
    terminals.kill(info.terminalId)
    expect(leases.get(resource)).toBeNull()
    expect(events).toContainEqual(expect.objectContaining({ type: 'terminal_exited', terminalId: info.terminalId }))
    off()
    db.close()
    await settlePtyExit()
  })

  it('does not touch the database when a killed terminal reports its exit', async () => {
    // Shutdown runs killAll() and then db.close(); the pty's exit event lands
    // after both, so writing from it hits a closed connection.
    const { db, prepared } = freshDb()
    const terminals = new NodeTerminalManager(db)
    const dir = mkdtempSync(join(tmpdir(), 'sroe-terminal-cwd-'))
    dirs.push(dir)

    terminals.killAll()
    const info = terminals.create({ cwd: dir })
    terminals.kill(info.terminalId)
    prepared.length = 0

    await settlePtyExit()

    expect(prepared).toEqual([])
    db.close()
  })

  it('still records the exit code when a terminal exits on its own', async () => {
    const { db } = freshDb()
    const terminals = new NodeTerminalManager(db)
    const dir = mkdtempSync(join(tmpdir(), 'sroe-terminal-cwd-'))
    dirs.push(dir)

    const info = terminals.create({ cwd: dir, shell: '/bin/sh' })
    terminals.write(info.terminalId, 'exit 3\n')

    await settlePtyExit()

    const row = db
      .prepare(`SELECT exit_code FROM terminals WHERE terminal_id = ?`)
      .get(info.terminalId) as { exit_code: number | null } | undefined
    expect(row?.exit_code).toBe(3)
    db.close()
  })

  it('survives the real shutdown order of killAll() followed by db.close()', async () => {
    const { db } = freshDb()
    const terminals = new NodeTerminalManager(db)
    const dir = mkdtempSync(join(tmpdir(), 'sroe-terminal-cwd-'))
    dirs.push(dir)

    terminals.create({ cwd: dir })
    terminals.create({ cwd: dir })
    terminals.killAll()
    db.close()

    const uncaught: Error[] = []
    const onUncaught = (err: Error): void => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)
    await settlePtyExit()
    process.off('uncaughtException', onUncaught)

    expect(uncaught).toEqual([])
  })
})
