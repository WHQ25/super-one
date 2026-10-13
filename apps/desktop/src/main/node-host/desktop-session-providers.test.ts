import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createSessionProviderStore } from '@superone/runtime/session'
import { REDACTED_PROFILE_SECRET, redactedSessionProviderStore } from './desktop-session-providers'

const R = REDACTED_PROFILE_SECRET

function stores() {
  const db = new Database(':memory:')
  const raw = createSessionProviderStore(db)
  /** As `updateBaseProviderConfig` does: base profiles are not editable through the store. */
  const setBaseConfig = (id: string, config: unknown) =>
    db.prepare('UPDATE session_providers SET config_json = ? WHERE id = ?').run(JSON.stringify(config), id)
  return { raw, redacted: redactedSessionProviderStore(raw), setBaseConfig }
}

describe('redactedSessionProviderStore', () => {
  it('never returns profile secrets to a node client', () => {
    const { redacted, setBaseConfig } = stores()
    const created = redacted.create({
      harnessId: 'claude',
      name: 'Team',
      config: { model: 'claude-opus', apiKey: 'sk-secret', extraEnv: { TOKEN: 't0k' } },
    })
    const masked = { model: 'claude-opus', apiKey: R, extraEnv: { TOKEN: R } }
    expect(created.config).toEqual(masked)
    expect(redacted.get(created.id)?.config).toEqual(masked)
    expect(redacted.list().find((p) => p.id === created.id)?.config).toEqual(masked)
    expect(redacted.listByHarness('claude').find((p) => p.id === created.id)?.config).toEqual(masked)

    setBaseConfig('opencode-base', { serverPassword: 'pw', env: { A: '1' } })
    expect(redacted.getBase('opencode').config).toEqual({ serverPassword: R, env: { A: R } })
    setBaseConfig('cursor-base', { apiKey: 'ciphertext', cloudEnvVars: { K: 'v' }, model: 'auto' })
    expect(redacted.get('cursor-base')?.config).toEqual({ apiKey: R, cloudEnvVars: { K: R }, model: 'auto' })
    expect(redacted.get('missing')).toBeNull()
  })

  it('keeps stored secrets when a client writes redacted values back', () => {
    const { raw, redacted } = stores()
    const { id } = raw.create({ harnessId: 'codex', name: 'Team', config: { apiKey: 'sk-secret', extraEnv: { A: 'a', B: 'b' } } })

    const edited = redacted.get(id)!
    redacted.update(id, { config: { ...(edited.config as object), model: 'gpt-5', extraEnv: { A: R, C: 'c' } } })
    expect(raw.get(id)?.config).toEqual({ apiKey: 'sk-secret', model: 'gpt-5', extraEnv: { A: 'a', C: 'c' } })

    redacted.update(id, { config: { apiKey: 'sk-new' } })
    expect(raw.get(id)?.config).toEqual({ apiKey: 'sk-new' })

    const copy = redacted.create({ harnessId: 'codex', name: 'Copy', config: { apiKey: R, extraEnv: { A: R } } })
    expect(raw.get(copy.id)?.config).toEqual({ extraEnv: {} })
  })
})
