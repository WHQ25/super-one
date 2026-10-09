import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { keychainServiceNames, parseClaudeUsage as parseUsage, type ClaudeUsageResponse as UsageResponse } from './claude'

describe('parseUsage (Claude /api/oauth/usage → ClaudeRateLimits)', () => {
  it('maps each known utilization window with its label and converts resets_at ISO to epoch seconds', () => {
    const data: UsageResponse = {
      five_hour: { utilization: 25, resets_at: '2026-01-28T15:00:00Z' },
      seven_day: { utilization: 40, resets_at: '2026-02-01T00:00:00Z' },
      seven_day_opus: { utilization: 10, resets_at: '2026-02-01T00:00:00Z' },
      seven_day_sonnet: { utilization: 5, resets_at: '2026-02-01T00:00:00Z' },
      seven_day_omelette: { utilization: 0, resets_at: '2026-02-01T00:00:00Z' },
    }

    const result = parseUsage(data, 'Max 20x')

    expect(result.planType).toBe('Max 20x')
    expect(result.windows.map((w) => w.label)).toEqual(['5h', 'Weekly', 'Opus weekly', 'Sonnet weekly', 'Claude Design'])
    expect(result.windows[0]).toEqual({ id: 'five_hour', label: '5h', usedPercent: 25, resetsAt: Math.floor(Date.parse('2026-01-28T15:00:00Z') / 1000) })
    expect(result.windows[4].usedPercent).toBe(0)
  })

  it('skips windows missing a numeric utilization and tolerates a missing resets_at', () => {
    const data: UsageResponse = {
      five_hour: { utilization: 12 },
      seven_day: { resets_at: '2026-02-01T00:00:00Z' },
    }

    const result = parseUsage(data, null)

    expect(result.windows).toHaveLength(1)
    expect(result.windows[0]).toEqual({ id: 'five_hour', label: '5h', usedPercent: 12, resetsAt: null })
    expect(result.planType).toBeNull()
  })

  it('converts enabled extra_usage credits/limit from cents to dollars', () => {
    const data: UsageResponse = {
      five_hour: { utilization: 1 },
      extra_usage: { is_enabled: true, used_credits: 500, monthly_limit: 10000 },
    }

    const result = parseUsage(data, null)

    expect(result.extraUsage).toEqual({ usedDollars: 5, limitDollars: 100 })
  })

  it('treats a zero monthly_limit as no limit', () => {
    const data: UsageResponse = { extra_usage: { is_enabled: true, used_credits: 250, monthly_limit: 0 } }

    const result = parseUsage(data, null)

    expect(result.extraUsage).toEqual({ usedDollars: 2.5, limitDollars: null })
  })

  it('ignores extra_usage when not enabled', () => {
    const data: UsageResponse = { extra_usage: { is_enabled: false, used_credits: 500, monthly_limit: 10000 } }

    expect(parseUsage(data, null).extraUsage).toBeNull()
  })
})

describe('parseUsage — model-scoped weekly windows from limits[]', () => {
  it('reads a scoped weekly window by display_name and places it right after Weekly', () => {
    const data: UsageResponse = {
      five_hour: { utilization: 25 },
      seven_day: { utilization: 40 },
      seven_day_sonnet: null,
      limits: [
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 7,
          resets_at: '2026-02-01T00:00:00Z',
          scope: { model: { display_name: 'Fable', id: null }, surface: null },
        },
      ],
    }

    const result = parseUsage(data, 'Max 20x')

    expect(result.windows.map((w) => w.label)).toEqual(['5h', 'Weekly', 'Fable weekly'])
    expect(result.windows[2]).toEqual({
      model: 'fable', id: 'weekly_scoped:Fable', label: 'Fable weekly',
      usedPercent: 7,
      resetsAt: Math.floor(Date.parse('2026-02-01T00:00:00Z') / 1000),
    })
  })

  it('prefers the scoped row over a legacy top-level window for the same model', () => {
    const data: UsageResponse = {
      seven_day_sonnet: { utilization: 5 },
      limits: [
        { kind: 'weekly_scoped', percent: 33, scope: { model: { display_name: 'Sonnet' } } },
      ],
    }

    const result = parseUsage(data, null)

    expect(result.windows).toEqual([{ model: 'sonnet', id: 'seven_day_sonnet', label: 'Sonnet weekly', usedPercent: 33, resetsAt: null }])
  })

  it('ignores limits entries that are not weekly_scoped, lack a model name, or lack a numeric percent', () => {
    const data: UsageResponse = {
      limits: [
        { kind: 'weekly', percent: 40, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 40 },
        { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 40, scope: { model: { display_name: '  ' } } },
      ],
    }

    expect(parseUsage(data, null).windows).toEqual([])
  })

  it('de-duplicates repeated scoped rows for the same model, keeping the first', () => {
    const data: UsageResponse = {
      limits: [
        { kind: 'weekly_scoped', percent: 7, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 99, scope: { model: { display_name: 'Fable' } } },
      ],
    }

    expect(parseUsage(data, null).windows).toEqual([{ model: 'fable', id: 'weekly_scoped:Fable', label: 'Fable weekly', usedPercent: 7, resetsAt: null }])
  })
})

describe('keychainServiceNames — mirrors the CLI\'s own service-name construction', () => {
  const BASE = 'Claude Code-credentials'
  // sha256("/domains/work").slice(0,8) — the CLI hashes the NFC-normalized path.
  const hashOf = (path: string) =>
    createHash('sha256').update(path.normalize('NFC')).digest('hex').slice(0, 8)

  it('uses the bare service when neither env var is set', () => {
    expect(keychainServiceNames(null, {})).toEqual([BASE])
  })

  it('hashes CLAUDE_CONFIG_DIR when only that is set', () => {
    expect(keychainServiceNames(null, { CLAUDE_CONFIG_DIR: '/custom/home' }))
      .toEqual([`${BASE}-${hashOf('/custom/home')}`, BASE])
  })

  it('lets CLAUDE_SECURESTORAGE_CONFIG_DIR win over CLAUDE_CONFIG_DIR', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/home', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/domains/work' }
    expect(keychainServiceNames(null, env)[0]).toBe(`${BASE}-${hashOf('/domains/work')}`)
  })

  it('treats an empty CLAUDE_SECURESTORAGE_CONFIG_DIR as the default domain, even with a custom config dir', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/home', CLAUDE_SECURESTORAGE_CONFIG_DIR: '' }
    expect(keychainServiceNames(null, env)).toEqual([BASE])
  })

  it('hashes an explicit credential dir and ignores both env vars', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/home', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/domains/other' }
    expect(keychainServiceNames('/domains/work', env)).toEqual([`${BASE}-${hashOf('/domains/work')}`])
  })

  it('never falls back to the default service for an explicit domain', () => {
    // Falling back would read a *different account's* credentials and silently report its usage.
    expect(keychainServiceNames('/domains/work', {})).not.toContain(BASE)
  })

  it('normalizes to NFC so a decomposed path hashes like the CLI composes it', () => {
    const composed = '/domains/caf\u00e9'
    const decomposed = '/domains/cafe\u0301'
    expect(decomposed).not.toBe(composed)
    expect(keychainServiceNames(decomposed, {})).toEqual(keychainServiceNames(composed, {}))
  })
})
