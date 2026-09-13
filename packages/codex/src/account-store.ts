import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CodexAccountStatus } from '@superone/shared/agent-types'
import { CODEX_CLI_ACCOUNT_ID, codexAccountId, codexAccountProviderId, type CodexAccount } from '@superone/shared/codex-accounts'

interface AccountIndex {
  version: 1
  defaultId: string | null
  accounts: Array<{ id: string; status: CodexAccountStatus; authGeneration?: number }>
}

const signedOut: CodexAccountStatus = {
  signedIn: false, authMode: null, email: null, planType: null, requiresOpenaiAuth: true,
}

/** Node-local metadata only. Codex owns all OAuth tokens and their refresh lifecycle. */
export class CodexAccountStore {
  constructor(
    readonly root: string,
    readonly cliHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'),
  ) {}

  private read(): AccountIndex {
    try {
      const data = JSON.parse(readFileSync(join(this.root, 'accounts.json'), 'utf8')) as AccountIndex
      if (data.version !== 1 || !Array.isArray(data.accounts)) throw new Error('Invalid Codex account registry')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, defaultId: null, accounts: [] }
      throw error
    }
  }

  private write(data: AccountIndex): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const temporary = join(this.root, `accounts-${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
    renameSync(temporary, join(this.root, 'accounts.json'))
  }

  list(): CodexAccount[] {
    const data = this.read()
    return data.accounts.map(({ id, status }) => ({ ...status, id, isDefault: id === data.defaultId }))
  }

  defaultProviderId(): string | null {
    const account = this.list().find((a) => a.isDefault && a.signedIn)
    return account ? codexAccountProviderId(account.id) : null
  }

  allocate(): string {
    const id = randomUUID()
    const data = this.read()
    data.accounts.push({ id, status: { ...signedOut } })
    this.write(data)
    this.prepare(id)
    return id
  }

  home(id: string): string {
    codexAccountId(codexAccountProviderId(id)) // Validate before resolving any client-supplied path.
    if (id === CODEX_CLI_ACCOUNT_ID) return this.cliHome
    if (!this.read().accounts.some((a) => a.id === id)) throw new Error('Unknown Codex account')
    const path = join(this.root, id)
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Codex account directory must not be a symlink')
    return path
  }

  update(id: string, status: CodexAccountStatus): void {
    this.home(id)
    const data = this.read()
    const existing = data.accounts.find((a) => a.id === id)
    // Do not list the CLI's empty login as a newly added account.
    if (!existing && !status.signedIn) return
    const chatgpt = status.authMode === 'chatgpt' || status.authMode === 'chatgptAuthTokens'
    const next = { ...status, signedIn: status.signedIn && chatgpt }
    if (id !== CODEX_CLI_ACCOUNT_ID && existing?.status.email && next.signedIn && next.email !== existing.status.email) {
      existing.status.signedIn = false
      this.write(data)
      throw new Error('This profile belongs to another ChatGPT account. Add the other account separately.')
    }
    if (existing) existing.status = { ...next, email: next.email ?? existing.status.email }
    else data.accounts.push({ id, status: next })
    if (!data.accounts.some((a) => a.id === data.defaultId && a.status.signedIn)) {
      data.defaultId = data.accounts.find((a) => a.status.signedIn)?.id ?? null
    }
    this.write(data)
  }

  invalidateCredentials(id: string): void {
    const data = this.read()
    const account = data.accounts.find((entry) => entry.id === id)
    if (!account) return
    account.authGeneration = (account.authGeneration ?? 0) + 1
    this.write(data)
  }

  setDefault(id: string): void {
    this.home(id)
    const data = this.read()
    if (!data.accounts.some((a) => a.id === id && a.status.signedIn)) throw new Error('Sign in before selecting a default Codex account')
    data.defaultId = id
    this.write(data)
  }

  /** Inherit user configuration and installed resources, never auth, databases or transcripts. */
  prepare(id: string): string {
    const target = this.home(id)
    mkdirSync(target, { recursive: true, mode: 0o700 })
    if (id === CODEX_CLI_ACCOUNT_ID || resolve(target) === resolve(this.cliHome)) return target
    if (!existsSync(this.cliHome)) return target
    for (const entry of readdirSync(this.cliHome)) {
      const source = join(this.cliHome, entry)
      const destination = join(target, entry)
      if (entry === 'config.toml' || entry === 'AGENTS.md' || entry.endsWith('.config.toml')) {
        const temporary = `${destination}.${randomUUID()}.tmp`
        copyFileSync(source, temporary)
        renameSync(temporary, destination)
      } else if (['skills', 'rules', 'agents', 'prompts', 'plugins'].includes(entry) && !existsSync(destination)) {
        try { symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
    }
    return target
  }

  environment(providerId: string, base: NodeJS.ProcessEnv, allowSignedOut = false): NodeJS.ProcessEnv {
    const id = codexAccountId(providerId)
    if (!id) throw new Error('Expected a Codex account')
    if (!allowSignedOut && id !== CODEX_CLI_ACCOUNT_ID && !this.list().some((a) => a.id === id && a.signedIn)) {
      throw new Error('Please sign in to this Codex account before continuing.')
    }
    const env: NodeJS.ProcessEnv = { ...base, CODEX_HOME: this.prepare(id), SUPERONE_CODEX_ACCOUNT_REVISION: String(this.read().accounts.find((a) => a.id === id)?.authGeneration ?? 0) }
    // An explicitly selected subscription must never inherit API/other account credentials.
    for (const key of ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_BASE_URL', 'CODEX_ACCESS_TOKEN', 'OPENAI_FEDERATION_RULE_ID', 'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_WORKLOAD_IDENTITY_CONTEXT']) delete env[key]
    if (id !== CODEX_CLI_ACCOUNT_ID) env.CODEX_SQLITE_HOME = env.CODEX_HOME
    return env
  }

  cliOverrides(providerId: string): string[] {
    const id = codexAccountId(providerId)
    if (!id) return []
    return [
      '-c', 'model_provider="openai"',
      ...(id === CODEX_CLI_ACCOUNT_ID ? [] : [
        '-c', 'cli_auth_credentials_store="file"',
        '-c', `sqlite_home=${JSON.stringify(this.home(id))}`,
      ]),
    ]
  }
}
