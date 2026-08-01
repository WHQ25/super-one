import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { HarnessManager } from './harness-manager'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function bootManager() {
  const dir = mkdtempSync(join(tmpdir(), 'hm-'))
  dirs.push(dir)
  const db = openNodeDatabase(join(dir, 'state.sqlite'))
  return { db, manager: new HarnessManager(db), dir, path: join(dir, 'state.sqlite') }
}

describe('HarnessManager', () => {
  it('defaults every first-party harness to disabled', () => {
    const { manager, db } = bootManager()
    const list = manager.list()
    expect(list).toHaveLength(4)
    expect(list.every((s) => !s.enabled && s.state === 'disabled')).toBe(true)
    expect(manager.readySessionHarnessIds()).toEqual([])
    expect(manager.isSessionHarnessRunnable('codex')).toBe(false)
    db.close()
  })

  it('advertises only enabled+ready harnesses on the session wire id', () => {
    const { manager, db } = bootManager()
    manager.update('codex', { enabled: true, state: 'ready', runtimeVersion: '0.1.0' })
    manager.update('claude', { enabled: true, state: 'needs_auth' })
    manager.update('acp-grok', {
      enabled: true,
      state: 'ready',
      command: '/opt/grok',
    })

    expect(manager.readySessionHarnessIds()).toEqual(['codex', 'acp'])
    expect(manager.isSessionHarnessRunnable('codex')).toBe(true)
    expect(manager.isSessionHarnessRunnable('acp')).toBe(true)
    expect(manager.isSessionHarnessRunnable('acp-grok')).toBe(true)
    expect(manager.isSessionHarnessRunnable('claude')).toBe(false)
    db.close()
  })

  it('persists across reopen and never returns secret fields or free-form errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-persist-'))
    dirs.push(dir)
    const path = join(dir, 'state.sqlite')
    {
      const db = openNodeDatabase(path)
      const manager = new HarnessManager(db)
      manager.update('opencode', {
        enabled: true,
        state: 'error',
        command: '/usr/bin/opencode',
        secretRef: 'secrets/opencode-password',
        configJson: JSON.stringify({ startupTimeoutMs: 5000 }),
        diagnosticCode: 'probe_failed',
      })
      db.close()
    }
    {
      const db = openNodeDatabase(path)
      const manager = new HarnessManager(db)
      const status = manager.get('opencode')
      expect(status.enabled).toBe(true)
      expect(status.state).toBe('error')
      expect(status.command).toBe('/usr/bin/opencode')
      // Public status never exposes secret field names or raw secret values.
      expect(status).not.toHaveProperty('secretRef')
      expect(status).not.toHaveProperty('configJson')
      expect(status).not.toHaveProperty('secret_ref')
      expect(JSON.stringify(status)).not.toContain('secrets/opencode-password')
      // Message is authored template only.
      expect(status.diagnostic?.code).toBe('probe_failed')
      expect(status.diagnostic?.message).toContain('readiness probe failed')
      // DB row must not contain free-form secret material either.
      const row = db
        .prepare(
          `SELECT diagnostic_code, diagnostic_message FROM harness_installations WHERE harness_id = ?`,
        )
        .get('opencode') as { diagnostic_code: string; diagnostic_message: string }
      expect(row.diagnostic_code).toBe('probe_failed')
      expect(row.diagnostic_message).toContain('readiness probe failed')
      expect(row.diagnostic_message).not.toMatch(/Bearer|password=|sk-/i)
      db.close()
    }
  })

  it('does not accept or persist free-form diagnostic secret strings', () => {
    const { manager, db } = bootManager()
    // TypeScript no longer allows diagnosticMessage; verify even if a legacy
    // raw row is injected, public get rebuilds from allowlisted code only.
    db.prepare(
      `UPDATE harness_installations SET
         enabled = 1, state = 'error',
         diagnostic_code = 'probe_failed',
         diagnostic_message = ?,
         updated_at = ?
       WHERE harness_id = 'codex'`,
    ).run(
      'OPENAI_API_KEY=sk-review-secret Authorization: Basic dXNlcjpwYXNz password="super secret"',
      Date.now(),
    )
    const status = manager.get('codex')
    expect(status.diagnostic?.code).toBe('probe_failed')
    expect(status.diagnostic?.message).toBe('readiness probe failed')
    expect(JSON.stringify(status)).not.toContain('sk-review-secret')
    expect(JSON.stringify(status)).not.toContain('dXNlcjpwYXNz')
    expect(JSON.stringify(status)).not.toContain('super secret')

    // update with allowlisted code rewrites durable message to the template.
    manager.update('codex', { diagnosticCode: 'probe_failed' })
    const row = db
      .prepare(
        `SELECT diagnostic_message FROM harness_installations WHERE harness_id = ?`,
      )
      .get('codex') as { diagnostic_message: string }
    expect(row.diagnostic_message).toContain('readiness probe failed')
    expect(row.diagnostic_message).not.toContain('sk-review-secret')
    expect(row.diagnostic_message).not.toContain('dXNlcjpwYXNz')
    expect(row.diagnostic_message).not.toContain('super secret')
    db.close()
  })

  it('drops relative commands instead of advertising them', () => {
    const { manager, db } = bootManager()
    manager.update('opencode', {
      enabled: true,
      state: 'ready',
      command: 'opencode',
    })
    expect(manager.get('opencode').command).toBeUndefined()
    db.close()
  })

  it('enableSimulatedOverlay is in-memory only and does not contaminate a production reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-sim-'))
    dirs.push(dir)
    const path = join(dir, 'state.sqlite')
    {
      const db = openNodeDatabase(path)
      const manager = new HarnessManager(db)
      manager.enableSimulatedOverlay()
      expect(manager.readySessionHarnessIds()).toEqual(['claude', 'codex', 'opencode', 'acp'])
      db.close()
    }
    {
      const db = openNodeDatabase(path)
      const manager = new HarnessManager(db)
      expect(manager.readySessionHarnessIds()).toEqual([])
      expect(manager.list().every((s) => s.state === 'disabled')).toBe(true)
      db.close()
    }
  })

  it('clears durable simulated contamination left by older builds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-contam-'))
    dirs.push(dir)
    const path = join(dir, 'state.sqlite')
    {
      const db = openNodeDatabase(path)
      // Simulate legacy code that wrote simulated readiness into SQLite.
      db.prepare(
        `INSERT INTO harness_installations
          (harness_id, enabled, state, runtime_version, command, config_json, secret_ref,
           diagnostic_code, diagnostic_message, last_probed_at, updated_at)
         VALUES ('codex', 1, 'ready', 'simulated', NULL, NULL, NULL, 'simulated', 'sim', NULL, ?)`,
      ).run(Date.now())
      db.close()
    }
    {
      const db = openNodeDatabase(path)
      const manager = new HarnessManager(db)
      expect(manager.get('codex')).toMatchObject({ enabled: false, state: 'disabled' })
      expect(manager.readySessionHarnessIds()).toEqual([])
      db.close()
    }
  })

  it('disable clears runnable status without deleting the row', () => {
    const { manager, db } = bootManager()
    manager.update('codex', { enabled: true, state: 'ready' })
    manager.disable('codex')
    expect(manager.get('codex')).toMatchObject({
      enabled: false,
      state: 'disabled',
    })
    expect(manager.readySessionHarnessIds()).toEqual([])
    db.close()
  })
})
