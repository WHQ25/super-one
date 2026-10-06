import { homedir } from 'node:os'
import { existsSync, copyFileSync, symlinkSync, mkdirSync, readFileSync, renameSync, writeFileSync, lstatSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { claudeAccountProviderId, type ClaudeAccount } from '@superone/shared/agent-types'
import { superoneHome } from '../superone-home'

export interface StoredClaudeAccount {
  account: ClaudeAccount
  fingerprint?: string
  verifiedAt?: number
  ownerIdentity?: string
  identityMismatch?: boolean
}
interface AccountIndex {
  version: 1
  defaultDir?: string | null
  accounts: Record<string, StoredClaudeAccount>
}
const key = (dir: string | null) => dir ?? '__cli__'

/** Metadata only. Claude owns the credential store; old directory IDs remain usable. */
export class ClaudeAccountStore {
  constructor(readonly root: string) {}
  private read(): AccountIndex {
    try {
      const value = JSON.parse(readFileSync(join(this.root, 'accounts.json'), 'utf8')) as AccountIndex
      if (value.version !== 1 || !value.accounts || typeof value.accounts !== 'object') throw new Error('Invalid Claude account registry')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, accounts: {} }
      throw error
    }
  }
  private write(index: AccountIndex): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const temporary = join(this.root, `accounts-${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify(index), { mode: 0o600 })
    renameSync(temporary, join(this.root, 'accounts.json'))
  }
  assertManaged(dir: string): void {
    if (resolve(dir) !== dir || dirname(resolve(dir)) !== resolve(this.root) || lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) {
      throw new Error('Unknown Claude account directory')
    }
  }
  dirs(): string[] {
    try { return readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(this.root, entry.name)).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  prepareSessionHome(dir: string): void {
    this.assertManaged(dir)
    const shared = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
    // Sharing transcripts preserves SDK history/fork/resume without sharing oauthAccount.
    mkdirSync(join(shared, 'projects'), { recursive: true })
    for (const name of ['projects', 'skills', 'agents', 'commands', 'plugins', 'output-styles']) {
      const source = join(shared, name), target = join(dir, name)
      if (existsSync(source) && !existsSync(target)) {
        try { symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
    }
    // Files are copied atomically; Windows file symlinks may require elevated privileges.
    for (const name of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
      const source = join(shared, name)
      if (!existsSync(source)) continue
      const temporary = join(dir, `${name}.${randomUUID()}.tmp`)
      copyFileSync(source, temporary); renameSync(temporary, join(dir, name))
    }
    const sharedConfig = process.env.CLAUDE_CONFIG_DIR ? join(shared, '.claude.json') : join(homedir(), '.claude.json')
    const readConfig = (path: string): Record<string, unknown> => {
      try { return JSON.parse(readFileSync(path, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
    }
    const source = readConfig(sharedConfig), target = readConfig(join(dir, '.claude.json'))
    const profile = this.get(dir)?.account
    const existingProfile = target.oauthAccount as Record<string, unknown> | undefined
    if (profile?.accountUuid && profile.orgId) target.oauthAccount = {
      ...(existingProfile?.accountUuid === profile.accountUuid && existingProfile.organizationUuid === profile.orgId ? existingProfile : {}),
      accountUuid: profile.accountUuid, emailAddress: profile.email, organizationUuid: profile.orgId, organizationName: profile.orgName,
    }
    else delete target.oauthAccount
    // MCP definitions and project approvals belong to the user; OAuth/profile fields remain local.
    for (const name of ['mcpServers', 'projects']) {
      if (source[name] !== undefined) target[name] = source[name]
    }
    const temporary = join(dir, `config-${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify(target), { mode: 0o600 })
    renameSync(temporary, join(dir, '.claude.json'))
  }
  get(dir: string | null): StoredClaudeAccount | undefined { return this.read().accounts[key(dir)] }
  update(dir: string | null, value: StoredClaudeAccount): void {
    const index = this.read()
    const ownerIdentity = dir ? index.accounts[key(dir)]?.ownerIdentity
      ?? (value.account.identityStatus === 'verified' ? value.account.identityKey ?? undefined : undefined) : undefined
    index.accounts[key(dir)] = { ...value, ...(ownerIdentity ? { ownerIdentity } : {}) }
    // Initialize once. Explicitly chosen accounts never silently change on an outage or logout.
    if (index.defaultDir === undefined && value.account.loggedIn) index.defaultDir = dir
    this.write(index)
  }
  isDefault(dir: string | null): boolean { return this.read().defaultDir === dir }
  defaultProviderId(): string | null {
    const dir = this.read().defaultDir
    return dir === undefined ? null : claudeAccountProviderId(dir)
  }
  setDefault(dir: string | null): void {
    if (dir) this.assertManaged(dir)
    const index = this.read()
    if (!index.accounts[key(dir)]?.account.loggedIn) throw new Error('Sign in before selecting a default Claude account')
    index.defaultDir = dir
    this.write(index)
  }
}
export function claudeAccountStore(): ClaudeAccountStore {
  return new ClaudeAccountStore(join(superoneHome(), 'claude-accounts'))
}
