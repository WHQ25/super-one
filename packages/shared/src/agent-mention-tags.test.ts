import { describe, it, expect } from 'vitest'
import {
  AGENT_TAG_REGEX,
  decodeAgentRef,
  dedupeAgentSlugs,
  encodeAgentRef,
  formatAgentMentionReminder,
  replaceAgentTagsWithMention,
  slugForBrandKey,
  slugifyAgentName,
  wrapAgentMention,
} from './agent-mention-tags'

describe('agent mention refs', () => {
  it('round-trips a plain provider id', () => {
    expect(encodeAgentRef({ providerId: 'codex-base' })).toBe('codex-base')
    expect(decodeAgentRef('codex-base')).toEqual({ providerId: 'codex-base' })
  })

  it('round-trips an ACP provider carrying a secondary agent id', () => {
    const ref = encodeAgentRef({ providerId: 'acp-base', acpAgentId: 'grok-build' })
    expect(ref).toBe('acp-base:grok-build')
    expect(decodeAgentRef(ref)).toEqual({ providerId: 'acp-base', acpAgentId: 'grok-build' })
  })

  it('drops an empty acpAgentId instead of emitting a dangling separator', () => {
    expect(encodeAgentRef({ providerId: 'codex-base', acpAgentId: '  ' })).toBe('codex-base')
  })

  it('returns null for empty or provider-less input', () => {
    expect(decodeAgentRef('')).toBeNull()
    expect(decodeAgentRef('   ')).toBeNull()
    expect(decodeAgentRef(':grok-build')).toBeNull()
  })
})

describe('agent mention slugs', () => {
  it('maps known brand keys to the keyword a user would type', () => {
    expect(slugForBrandKey('codex', 'Codex (Base)').slug).toBe('codex')
    expect(slugForBrandKey('acp-grok', 'Grok').slug).toBe('grok')
    expect(slugForBrandKey('dsh', 'DeepSeek (Base)').slug).toBe('deepseek')
  })

  it('derives a slug for an ACP agent nobody hardcoded', () => {
    expect(slugForBrandKey('acp-zed', 'Zed').slug).toBe('zed')
  })

  it('falls back to the display name when the brand key yields nothing', () => {
    expect(slugForBrandKey('', 'My Run Config').slug).toBe('my-run-config')
  })

  it('strips parenthesised qualifiers so "Codex (Base)" is not @codex-base', () => {
    expect(slugifyAgentName('Codex (Base)')).toBe('codex')
  })

  it('suffixes later duplicates so the first (base) row keeps the plain keyword', () => {
    expect(
      dedupeAgentSlugs([
        { slug: 'codex', id: 'codex-base' },
        { slug: 'codex', id: 'codex-custom' },
        { slug: 'codex', id: 'codex-other' },
      ]),
    ).toEqual([
      { slug: 'codex', id: 'codex-base' },
      { slug: 'codex-2', id: 'codex-custom' },
      { slug: 'codex-3', id: 'codex-other' },
    ])
  })
})

describe('agent mention tags', () => {
  it('renders back to a readable @name for plain-text consumers', () => {
    const text = `hi ${wrapAgentMention('codex-base', 'Codex')} please review`
    expect(replaceAgentTagsWithMention(text)).toBe('hi @Codex please review')
  })

  it('matches a tag whose ref carries the ACP separator', () => {
    const text = wrapAgentMention('acp-base:grok-build', 'Grok')
    const match = new RegExp(AGENT_TAG_REGEX).exec(text)
    expect(match?.[1]).toBe('Grok')
    expect(match?.[2]).toBe('acp-base:grok-build')
  })
})

describe('agent mention reminder', () => {
  it('is empty when nothing was mentioned', () => {
    expect(formatAgentMentionReminder([])).toBe('')
  })

  it('pins the agent id and forbids re-deriving it', () => {
    const out = formatAgentMentionReminder([{ displayName: 'Codex', providerId: 'codex-base' }])
    expect(out).toContain('- "Codex" → agentId "codex-base"')
    expect(out).toContain('do NOT call session_collab_list_agents')
    expect(out).toContain('<superone-agent-reminder>')
  })

  it('lists one line per provider even when mentioned twice', () => {
    const out = formatAgentMentionReminder([
      { displayName: 'Codex', providerId: 'codex-base' },
      { displayName: 'Codex', providerId: 'codex-base' },
      { displayName: 'Grok', providerId: 'acp-base' },
    ])
    expect(out.match(/→ agentId/g)).toHaveLength(2)
  })
})
