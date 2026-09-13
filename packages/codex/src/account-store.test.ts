import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAccountStore } from './account-store'
import { codexAccountProviderId } from '@superone/shared/codex-accounts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-accounts-test-'))
  roots.push(root)
  const legacy = join(root, 'legacy')
  mkdirSync(legacy)
  return { root, legacy, store: new CodexAccountStore(join(root, 'accounts'), legacy) }
}
const status = (email: string) => ({ signedIn: true, authMode: 'chatgpt' as const, email, planType: 'plus', requiresOpenaiAuth: true })
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Codex managed accounts', () => {
  it('defaults to the first completed login and persists a later explicit default', () => {
    const { store, root, legacy } = fixture()
    const a = store.allocate()
    const b = store.allocate()
    expect(store.defaultProviderId()).toBeNull()
    store.update(a, status('a@example.test'))
    store.update(b, status('b@example.test'))
    expect(store.defaultProviderId()).toBe(codexAccountProviderId(a))
    store.setDefault(b)
    const restored = new CodexAccountStore(join(root, 'accounts'), legacy)
    expect(restored.defaultProviderId()).toBe(codexAccountProviderId(b))
    expect(restored.list().find((account) => account.id === a)).toBeDefined()
    expect(restored.home(a)).not.toBe(restored.home(b))
  })

  it('isolates auth and history while inheriting common configuration and skills', () => {
    const { store, legacy } = fixture()
    writeFileSync(join(legacy, 'config.toml'), 'model = "test-model"\n')
    writeFileSync(join(legacy, 'auth.json'), 'private-cli-login')
    mkdirSync(join(legacy, 'skills'))
    writeFileSync(join(legacy, 'skills', 'example.md'), 'shared skill')
    const a = store.allocate()
    const b = store.allocate()
    store.update(a, status('a@example.test'))
    store.update(b, status('b@example.test'))
    const envA = store.environment(codexAccountProviderId(a), { CODEX_API_KEY: 'inherited', CODEX_SQLITE_HOME: '/shared-db' })
    const envB = store.environment(codexAccountProviderId(b), {})
    expect(envA.CODEX_HOME).not.toBe(envB.CODEX_HOME)
    expect(envA.CODEX_API_KEY).toBeUndefined()
    store.invalidateCredentials(a)
    expect(store.environment(codexAccountProviderId(a), {}).SUPERONE_CODEX_ACCOUNT_REVISION).not.toBe(envA.SUPERONE_CODEX_ACCOUNT_REVISION)
    expect(store.environment(codexAccountProviderId(b), {}).SUPERONE_CODEX_ACCOUNT_REVISION).toBe(envB.SUPERONE_CODEX_ACCOUNT_REVISION)
    expect(envA.CODEX_SQLITE_HOME).toBe(envA.CODEX_HOME)
    expect(readFileSync(join(envA.CODEX_HOME!, 'config.toml'), 'utf8')).toContain('test-model')
    expect(readFileSync(join(envA.CODEX_HOME!, 'skills', 'example.md'), 'utf8')).toBe('shared skill')
    expect(() => readFileSync(join(envA.CODEX_HOME!, 'auth.json'))).toThrow()
    writeFileSync(join(envA.CODEX_HOME!, 'auth.json'), 'account-a')
    expect(() => readFileSync(join(envB.CODEX_HOME!, 'auth.json'))).toThrow()
    expect(readFileSync(join(legacy, 'auth.json'), 'utf8')).toBe('private-cli-login')
  })

  it('preserves history on logout and never falls back from an unavailable account', () => {
    const { store } = fixture()
    const a = store.allocate()
    const b = store.allocate()
    store.update(a, status('a@example.test'))
    store.update(b, status('b@example.test'))
    writeFileSync(join(store.home(a), 'history.jsonl'), 'history')
    store.update(a, { ...status('a@example.test'), signedIn: false, authMode: null })
    expect(store.defaultProviderId()).toBe(codexAccountProviderId(b))
    expect(() => store.environment(codexAccountProviderId(a), {})).toThrow(/sign in/i)
    expect(readFileSync(join(store.home(a), 'history.jsonl'), 'utf8')).toBe('history')
    expect(() => store.home('../outside')).toThrow()
    expect(() => store.setDefault(a)).toThrow()
  })
})

it('rejects signing a different identity into a profile with existing history', () => {
  const { store } = fixture()
  const id = store.allocate()
  store.update(id, status('original@example.test'))
  expect(() => store.update(id, status('different@example.test'))).toThrow(/belongs to another/)
  expect(store.list()[0]).toMatchObject({ email: 'original@example.test', signedIn: false })
  expect(() => store.environment(codexAccountProviderId(id), {})).toThrow(/sign in/i)
  store.update(id, status('original@example.test'))
  expect(store.list()[0].signedIn).toBe(true)
})
