import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', dropped: [] as string[] }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => ({ artifactTransfers: { dropSession: (id: string) => state.dropped.push(id) } }),
}))

import { removeSessionZone } from './session-zone-reclaim'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zone-reclaim-'))
  state.userData = root
  state.dropped = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('session zone reclaim', () => {
  it('removes the session directory and cancels its transfer jobs', async () => {
    const dir = join(root, 'sync', 's1', 'browser')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.png'), 'x')
    await removeSessionZone('s1')
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    expect(state.dropped).toEqual(['s1'])
  })

  it('never touches the adhoc zone or an empty id', async () => {
    const adhoc = join(root, 'sync', 'adhoc')
    mkdirSync(adhoc, { recursive: true })
    writeFileSync(join(adhoc, 'manual.png'), 'x')
    await removeSessionZone('adhoc')
    await removeSessionZone('')
    expect(existsSync(adhoc)).toBe(true)
    expect(state.dropped).toEqual([])
  })
})
