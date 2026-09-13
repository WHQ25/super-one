import type { CodexAccountStatus } from '@superone/shared/agent-types'
import { CODEX_CLI_ACCOUNT_ID, codexAccountId, codexAccountProviderId, type CodexAccount, type CodexManagedLoginStart } from '@superone/shared/codex-accounts'
import { parseAccountLoginStart, parseAccountStatus } from './codex-admin'
import { CodexAccountStore } from './account-store'

export interface AccountConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  nextNotification(): Promise<{ method: string; params: Record<string, unknown> } | null>
  close(): Promise<void>
}

interface PendingLogin {
  accountId: string
  connection: AccountConnection
}

/** Shared by Electron and headless nodes. No tokens cross the host's public API. */
export class CodexAccountManager {
  private pending = new Map<string, PendingLogin>()
  private failed = new Set<string>()
  private starting = false
  private revisions = new Map<string, number>()
  constructor(
    readonly store: CodexAccountStore,
    private readonly open: (providerId: string) => Promise<AccountConnection>,
    private readonly changed: (providerId: string) => void = () => {},
  ) {}

  async status(providerId?: string | null): Promise<CodexAccountStatus> {
    const id = codexAccountId(providerId) ?? codexAccountId(this.store.defaultProviderId()) ?? CODEX_CLI_ACCOUNT_ID
    const revision = this.revisions.get(id) ?? 0
    const connection = await this.open(codexAccountProviderId(id))
    try {
      const status = parseAccountStatus(await connection.request('account/read', { refreshToken: false }))
      if ((this.revisions.get(id) ?? 0) === revision) this.store.update(id, status)
      return status
    } finally { await connection.close() }
  }

  async list(): Promise<CodexAccount[]> {
    const ids = [...new Set([CODEX_CLI_ACCOUNT_ID, ...this.store.list().map((a) => a.id)])]
    const unavailable = new Set<string>()
    // Bound subprocess fan-out when refreshing a large account list.
    for (let i = 0; i < ids.length; i += 4) {
      await Promise.all(ids.slice(i, i + 4).map(async (id) => {
        try { await this.status(codexAccountProviderId(id)) }
        catch { unavailable.add(id) }
      }))
    }
    return this.store.list().map((account) => ({
      ...account,
      ...(unavailable.has(account.id) ? { unavailable: true } : {}),
      ...([...this.pending.values()].some((p) => p.accountId === account.id)
        ? { loginState: 'pending' as const }
        : this.failed.has(account.id) ? { loginState: 'failed' as const } : {}),
    }))
  }

  async start(type: CodexManagedLoginStart['type'], accountId?: string): Promise<CodexManagedLoginStart> {
    // Browser OAuth uses a fixed callback port; serialize sign-ins, not chat sessions.
    if (this.pending.size || this.starting) throw new Error('Finish or cancel the current Codex sign-in first.')
    this.starting = true
    try {
      const id = accountId ?? this.store.allocate()
      this.store.home(id)
      this.failed.delete(id)
      this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
      const connection = await this.open(codexAccountProviderId(id))
      try {
        const result = parseAccountLoginStart(await connection.request('account/login/start', {
          type, ...(type === 'chatgpt' ? { useHostedLoginSuccessPage: true, appBrand: 'chatgpt' } : {}),
        }))
        const pending = { accountId: id, connection }
        this.pending.set(result.loginId, pending)
        void this.wait(result.loginId, pending)
        return { ...result, accountId: id }
      } catch (error) {
        this.failed.add(id)
        await connection.close()
        throw error
      }
    } finally { this.starting = false }
  }

  private async wait(loginId: string, pending: PendingLogin): Promise<void> {
    const deadline = Date.now() + 15 * 60_000
    const timeout = setTimeout(() => { void this.cancel(loginId).catch(() => {}); this.failed.add(pending.accountId) }, 15 * 60_000)
    timeout.unref?.()
    try {
      while (this.pending.get(loginId) === pending && Date.now() < deadline) {
        const notification = await pending.connection.nextNotification()
        if (!notification) throw new Error('Login connection closed')
        if (notification?.method !== 'account/login/completed' || notification.params.loginId !== loginId) continue
        if (notification.params.success !== true) throw new Error('Sign-in failed')
        const status = parseAccountStatus(await pending.connection.request('account/read', { refreshToken: false }))
        if (!status.signedIn) throw new Error('Sign-in did not complete')
        if (this.pending.get(loginId) !== pending) return
        this.store.update(pending.accountId, status)
        this.store.invalidateCredentials(pending.accountId)
        this.changed(codexAccountProviderId(pending.accountId))
        return
      }
      if (this.pending.get(loginId) === pending) this.failed.add(pending.accountId)
    } catch {
      this.failed.add(pending.accountId)
    } finally {
      clearTimeout(timeout)
      if (this.pending.get(loginId) === pending) this.pending.delete(loginId)
      await pending.connection.close().catch(() => {})
    }
  }

  async cancel(loginId: string): Promise<void> {
    const pending = this.pending.get(loginId)
    if (!pending) return
    this.pending.delete(loginId)
    try { await pending.connection.request('account/login/cancel', { loginId }) }
    finally { await pending.connection.close() }
  }

  async logout(providerId?: string | null): Promise<CodexAccountStatus> {
    const id = codexAccountId(providerId) ?? codexAccountId(this.store.defaultProviderId()) ?? CODEX_CLI_ACCOUNT_ID
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
    for (const [loginId, pending] of this.pending) {
      if (pending.accountId === id) await this.cancel(loginId)
    }
    const selected = codexAccountProviderId(id)
    const connection = await this.open(selected)
    try {
      await connection.request('account/logout')
      const status = parseAccountStatus(await connection.request('account/read', { refreshToken: false }))
      this.store.update(id, status)
      this.store.invalidateCredentials(id)
      this.changed(selected)
      return status
    } finally { await connection.close() }
  }

  async setDefault(id: string): Promise<void> {
    const status = await this.status(codexAccountProviderId(id))
    if (!status.signedIn) throw new Error('Sign in before selecting a default Codex account')
    this.store.setDefault(id)
  }

  dispose(): void {
    for (const [id] of this.pending) void this.cancel(id).catch(() => {})
  }
}
