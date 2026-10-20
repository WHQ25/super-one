import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir() },
}))

import { EnvironmentHost } from './environment-host'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FoldSync {
  foldRequest: (messageId: string, fold: string) => { revision: string; after?: string } | null
  applyFoldPage: (page: unknown, after: string | undefined) => boolean
  messages: () => ChatMessage[]
}

/** The private window and follow maps `loadRemoteFold` reads. */
function hostWith(sync: FoldSync | null, fold: (() => Promise<unknown>) | null) {
  const dir = mkdtempSync(join(tmpdir(), 'eh-fold-'))
  dirs.push(dir)
  const host = new EnvironmentHost(dir)
  const key = 'c:s'
  const raw = host as unknown as {
    remoteWindows: Map<string, FoldSync>
    followedSessions: Map<string, Promise<{ input: { sessionId: string; projectPath?: string; providerId?: string }; unfollow: () => void }>>
    resolveRemote: (connectionId: string) => {
      gateway: { sessions: { transcriptFold?: (request: unknown) => Promise<unknown> } }
      environmentId: string
      connectionId: string
    }
  }
  if (sync) raw.remoteWindows.set(key, sync)
  raw.followedSessions.set(key, Promise.resolve({
    input: { sessionId: 's', projectPath: '/proj', providerId: 'claude' },
    unfollow: () => {},
  }))
  raw.resolveRemote = () => ({
    gateway: { sessions: { ...(fold ? { transcriptFold: fold } : {}) } },
    environmentId: 'env',
    connectionId: 'c',
  })
  const seen: Array<{ connectionId: string; sessionId: string; projectPath?: string }> = []
  host.onRemoteSessionResync((target) => { seen.push(target) })
  return { host, seen }
}

const input = { sessionId: 's', messageId: 'm', fold: 'fold:k' }
const row = { id: 'm' } as ChatMessage

describe('loadRemoteFold stale revision', () => {
  it('resyncs the followed session when the host rejects the held revision', async () => {
    const { host, seen } = hostWith(
      { foldRequest: () => ({ revision: 'old' }), applyFoldPage: () => true, messages: () => [row] },
      () => Promise.reject(Object.assign(new Error('Fold changed'), { code: 'failed_precondition' })),
    )
    await expect(host.loadRemoteFold('c', input)).rejects.toMatchObject({ code: 'failed_precondition', message: 'Fold changed' })
    await Promise.resolve()
    expect(seen).toEqual([{ connectionId: 'c', sessionId: 's', projectPath: '/proj', providerId: 'claude' }])
    host.dispose()
  })

  it('resyncs when the page no longer applies, and leaves a transport failure alone', async () => {
    const rejected = hostWith(
      { foldRequest: () => ({ revision: 'old', after: 'k' }), applyFoldPage: () => false, messages: () => [row] },
      async () => ({ revision: 'old' }),
    )
    await expect(rejected.host.loadRemoteFold('c', input)).rejects.toMatchObject({ code: 'not_found', message: 'History changed' })
    await Promise.resolve()
    expect(rejected.seen).toEqual([{ connectionId: 'c', sessionId: 's', projectPath: '/proj', providerId: 'claude' }])
    rejected.host.dispose()

    const offline = hostWith(
      { foldRequest: () => ({ revision: 'old' }), applyFoldPage: () => true, messages: () => [row] },
      () => Promise.reject(new Error('offline')),
    )
    await expect(offline.host.loadRemoteFold('c', input)).rejects.toThrow('offline')
    await Promise.resolve()
    expect(offline.seen).toEqual([])
    offline.host.dispose()
  })

  it('returns the row and does not resync when the page joins', async () => {
    const { host, seen } = hostWith(
      { foldRequest: () => ({ revision: 'rev' }), applyFoldPage: () => true, messages: () => [row] },
      async () => ({ revision: 'rev' }),
    )
    await expect(host.loadRemoteFold('c', input)).resolves.toBe(row)
    await Promise.resolve()
    expect(seen).toEqual([])
    host.dispose()
  })
})
