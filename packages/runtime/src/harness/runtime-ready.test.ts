import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessManager } from './manager'
import { probeHarnessReadiness } from './runtime-ready'
import { loadClaudeCredentials } from '../usage/claude'
import { readCodexLogin } from '../usage/codex'

vi.mock('../usage/claude', () => ({ loadClaudeCredentials: vi.fn() }))
vi.mock('../usage/codex', () => ({ readCodexLogin: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SUPERONE_HARNESS_MARK_READY', '')
})
afterEach(() => vi.unstubAllEnvs())

describe.each(['claude', 'codex'] as const)('%s host login readiness', (id) => {
  function probe(withSdk = false) {
    const status = { enabled: true, state: 'needs_auth' }
    const manager = {
      get: () => status,
      update: (_id: string, patch: object) => Object.assign(status, patch),
    } as unknown as HarnessManager
    return probeHarnessReadiness(manager, id, {
      resolver: {
        resolveBinary: () => '/managed/cli',
        isRunnableWithoutCatalog: () => withSdk,
        autoRuntime: () => null,
      },
    })
  }

  it('promotes managed executables with an existing host login', () => {
    vi.mocked(loadClaudeCredentials).mockReturnValue({
      oauth: { accessToken: 'token' },
    } as NonNullable<ReturnType<typeof loadClaudeCredentials>>)
    vi.mocked(readCodexLogin).mockReturnValue({ accessToken: 'token', accountId: null })
    expect(probe()).toMatchObject({ ok: true, transitioned: true, state: 'ready' })
  })

  it('requires credentials for managed executables', () => {
    expect(probe()).toMatchObject({ ok: false, state: 'needs_auth' })
  })

  it('does not mistake runtime availability for authentication', () => {
    expect(probe(true)).toMatchObject({ ok: false, state: 'needs_auth' })
  })

  it('handles unreadable credentials', () => {
    vi.mocked(loadClaudeCredentials).mockImplementation(() => {
      throw new Error('denied')
    })
    vi.mocked(readCodexLogin).mockImplementation(() => {
      throw new Error('denied')
    })
    expect(probe()).toMatchObject({ ok: false, state: 'needs_auth' })
  })
})
