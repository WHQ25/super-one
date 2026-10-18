import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_APPLY_FIELD, type AgentEvent } from '@superone/shared/agent-types'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const mocks = vi.hoisted(() => ({ db: null as unknown, settings: { experimentalClaudeOpenAiChatEnabled: false } }))
vi.mock('../database', () => ({ getDb: () => mocks.db, maskApiKey: (key: string) => key ? `***${key.slice(-6)}` : '' }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => mocks.settings, parseSuggestionHarnessKey: vi.fn(), serializeSuggestionHarness: vi.fn() }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() } }))

import { configApplyHandler, configReadHandler, resolveConfigConfirm } from './config-tools'
import { createCredential, getBinding } from '../providers/credential-store'

const parse = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text)

describe('agent settings resource approval and persistence', () => {
  let db: DatabaseSync
  let project: string
  let deps: BuiltInSuperoneToolDeps
  let events: AgentEvent[]
  const providerBindingChanged = vi.fn()
  const projectPreferencesChanged = vi.fn()
  const setAppIcon = vi.fn(async (path: string | null) => ({ customAppIconPath: path }))

  beforeEach(() => {
    vi.clearAllMocks()
    db = new DatabaseSync(':memory:')
    mocks.db = db
    db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE credentials(id TEXT PRIMARY KEY, platform_id TEXT, plan_id TEXT, name TEXT, secret TEXT,
        secret_env TEXT, base_url TEXT, overrides_json TEXT, endpoints_json TEXT, notes TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE consumer_bindings(consumer TEXT PRIMARY KEY, credential_id TEXT, endpoint_id TEXT, config_json TEXT);
      CREATE TABLE custom_platforms(id TEXT PRIMARY KEY, definition_json TEXT);`)
    project = mkdtempSync(join(tmpdir(), 'config-settings-'))
    events = []
    deps = Object.assign({
      sessionId: 'settings-test', notifyDevAppReady: vi.fn(), applyAppSettings: vi.fn(),
      sessionHost: { getSession: () => ({ projectPath: project, setTitle: vi.fn(), emitHostEvent: (event: AgentEvent) => events.push(event) }) },
    }, { configServices: { providerBindingChanged, projectPreferencesChanged, setAppIcon } })
  })
  afterEach(() => { db.close(); rmSync(project, { recursive: true, force: true }) })

  function approve(action: 'accept' | 'decline' | 'cancel', values?: Record<string, unknown>) {
    const event = events.findLast((e) => e.type === 'permission_request')
    expect(event?.type).toBe('permission_request')
    if (event?.type !== 'permission_request') throw new Error('Missing confirmation')
    resolveConfigConfirm(event.request.requestId, action, values ? { [CONFIG_APPLY_FIELD]: JSON.stringify(values) } : undefined)
  }

  it('changes and clears a compatible default provider only after approval', async () => {
    const credential = createCredential({ platformId: 'zhipu-cn', planId: 'coding', name: 'Key', secret: 'sk-provider-secret' })
    const pending = configApplyHandler({ resource: { resource: 'default-provider', operation: 'update', recordId: 'chat:claude', values: { credentialId: credential.id } } }, deps)
    expect(getBinding('chat:claude')).toBeUndefined()
    approve('accept')
    expect(parse(await pending).status).toBe('applied')
    expect(getBinding('chat:claude')?.credentialId).toBe(credential.id)
    expect(providerBindingChanged).toHaveBeenCalledWith('chat:claude')
    const clear = configApplyHandler({ resource: { resource: 'default-provider', operation: 'update', recordId: 'chat:claude', values: { credentialId: null } } }, deps)
    approve('accept')
    expect(parse(await clear).status).toBe('applied')
    expect(getBinding('chat:claude')).toBeUndefined()
  })

  it('rejects incompatible credentials and unsupported operations before asking', async () => {
    const credential = createCredential({ platformId: 'zhipu-cn', planId: 'coding', name: 'Chat', secret: 'sk-secret' })
    const result = await configApplyHandler({ resource: { resource: 'default-provider', operation: 'update', recordId: 'media:video', values: { credentialId: credential.id } } }, deps)
    expect(parse(result).status).toBe('error')
    expect(events).toEqual([])
    expect(parse(await configApplyHandler({ resource: { resource: 'jev', operation: 'create', values: { apiKey: 'x' } } }, deps)).status).toBe('error')
    expect(events).toEqual([])
  })

  it.each(['decline', 'cancel'] as const)('does not persist a Jev key on %s', async (action) => {
    const pending = configApplyHandler({ resource: { resource: 'jev', operation: 'update', recordId: 'jev', values: { apiKey: 'sk-jev-secret-value' } } }, deps)
    approve(action)
    expect(parse(await pending).status).toBe(action === 'decline' ? 'rejected' : 'cancelled')
    expect(db.prepare('SELECT value FROM app_meta').get()).toBeUndefined()
  })

  it('encrypts the approved Jev key and never returns its plaintext', async () => {
    const pending = configApplyHandler({ resource: { resource: 'jev', operation: 'update', recordId: 'jev', values: { apiKey: 'sk-jev-secret-value' } } }, deps)
    approve('accept', { apiKey: 'sk-jev-edited-value' })
    const result = await pending
    expect(parse(result).status).toBe('applied')
    expect(JSON.stringify(result)).not.toContain('sk-jev-')
    expect(db.prepare('SELECT value FROM app_meta').get()).toMatchObject({ value: expect.stringMatching(/^enc:v1:/) })
    const read = configReadHandler({ domain: 'jev', recordId: 'jev' }, deps)
    expect(parse(read).currentValues.apiKey).toBe('***-value')
  })

  it('does not persist an approved key when the turn is interrupted before the write', async () => {
    const controller = new AbortController()
    const pending = configApplyHandler({ resource: { resource: 'jev', operation: 'update', recordId: 'jev', values: { apiKey: 'sk-not-written' } } }, { ...deps, signal: controller.signal })
    approve('accept')
    controller.abort()
    expect(parse(await pending).status).toBe('cancelled')
    expect(db.prepare('SELECT value FROM app_meta').get()).toBeUndefined()
  })

  it('revalidates a changed provider selection and refuses ambiguous mixed requests', async () => {
    const credential = createCredential({ platformId: 'zhipu-cn', planId: 'coding', name: 'Chat', secret: 'sk-secret' })
    const resource = { resource: 'default-provider', operation: 'update' as const, recordId: 'chat:claude', values: { credentialId: credential.id } }
    expect(parse(await configApplyHandler({ changes: [{ key: 'themeMode', value: 'dark' }], resource }, deps)).status).toBe('error')
    expect(events).toEqual([])
    const pending = configApplyHandler({ resource }, deps)
    approve('accept', { credentialId: 'missing-key' })
    expect(parse(await pending).status).toBe('error')
    expect(getBinding('chat:claude')).toBeUndefined()
    expect(providerBindingChanged).not.toHaveBeenCalled()
  })

  it('changes project output style in the session project while preserving unrelated configuration', async () => {
    mkdirSync(join(project, '.claude'))
    const path = join(project, '.claude/settings.local.json')
    writeFileSync(path, JSON.stringify({ permissions: { allow: ['Read'] }, outputStyle: 'Old' }))
    const pending = configApplyHandler({ resource: { resource: 'project-claude', operation: 'update', recordId: project, values: { outputStyle: 'Learning' } } }, deps)
    expect(JSON.parse(readFileSync(path, 'utf8')).outputStyle).toBe('Old')
    approve('accept', { outputStyle: 'Explanatory' })
    expect(parse(await pending).status).toBe('applied')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ permissions: { allow: ['Read'] }, outputStyle: 'Explanatory' })
    expect(projectPreferencesChanged).toHaveBeenCalled()
  })

  it('runs the shared icon effect only after approval and hides it outside development', async () => {
    const pending = configApplyHandler({ resource: { resource: 'app-icon', operation: 'update', recordId: 'app-icon', values: { filePath: '/tmp/icon.png' } } }, deps)
    expect(setAppIcon).not.toHaveBeenCalled()
    approve('accept')
    expect(parse(await pending).status).toBe('applied')
    expect(setAppIcon).toHaveBeenCalledWith('/tmp/icon.png')
    const unavailable = { ...deps, configServices: { providerBindingChanged, projectPreferencesChanged } }
    expect(parse(configReadHandler({}, unavailable)).domains.some((d: { domain: string }) => d.domain === 'app-icon')).toBe(false)
  })
})
