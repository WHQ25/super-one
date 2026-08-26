import { afterEach, describe, expect, it } from 'vitest'
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
