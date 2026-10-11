import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir() },
}))

const rows = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../db-sessions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../db-sessions')>(),
  listSessionsForProjectId: rows.list,
}))
vi.mock('../recent-folders', async (importOriginal) => ({
  ...await importOriginal<typeof import('../recent-folders')>(),
  getProjectPathById: (id: string) => (id === 'p1' ? '/repo' : null),
  getProjectId: (path: string) => (path === '/repo' ? 'p1' : null),
}))

import { EnvironmentHost } from './environment-host'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  rows.list.mockReset()
})

describe('EnvironmentHost local session list', () => {
  // The local protocol answers with phone/controller records (`harnessId`, no
  // branch); the sidebar needs the window's rows, or every session reads as Claude.
  it('lists the desktop rows, not the local protocol records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-local-'))
    dirs.push(dir)
    const host = new EnvironmentHost(dir)
    const protocolList = vi.spyOn(host.registry.getLocal().sessions, 'list')
    const row: SessionHistoryEntry = {
      sessionId: 's1', title: 'Phone Codex', lastActiveAt: '2026-10-11T00:00:00.000Z',
      provider: 'codex', messageCount: 0, gitBranch: 'feature', isWorktree: true, worktreePath: '/wt',
    }
    rows.list.mockReturnValue([row])

    expect(await host.listSessions('local', '/repo', { limit: 13, offset: 26 })).toEqual([row])
    expect(rows.list).toHaveBeenCalledWith('p1', 13, 26)
    expect(protocolList).not.toHaveBeenCalled()
    host.dispose()
  })
})
