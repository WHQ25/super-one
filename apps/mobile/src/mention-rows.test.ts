import { describe, expect, it } from 'vitest'
import { buildMentionRows, groupMentionRows, mentionGroupKey, MENTION_GROUP_ORDER, remapIndices } from './mention-rows'
import type { MentionItem } from './mentions'

const file = (path: string, matchIndices?: number[]): MentionItem => ({ kind: 'file', path, matchIndices })
const profile = (path: string, label: string, slug: string, aliases: string[] = []): MentionItem =>
  ({ kind: 'agent-profile', path, label, description: `@${slug}`, aliases })

describe('mentionGroupKey', () => {
  it('maps every kind onto a group the order actually lists', () => {
    // `groupItems` drops unlisted keys silently, so an unmapped kind vanishes.
    const kinds = ['builtin', 'computer', 'browser', 'widget', 'debug', 'agent-profile', 'session',
      'desktop-app', 'agent', 'miniapp', 'file', 'directory', 'dir-entry', 'future-kind']
    for (const kind of kinds) {
      expect(MENTION_GROUP_ORDER).toContain(mentionGroupKey({ kind, path: 'x' }))
    }
  })

  it('keeps collaborators apart from project agents, and mini-apps from desktop apps', () => {
    expect(mentionGroupKey({ kind: 'agent-profile', path: 'codex-base' })).toBe('agent-profile')
    expect(mentionGroupKey({ kind: 'agent', path: 'codex' })).toBe('agent')
    expect(mentionGroupKey({ kind: 'miniapp', path: 'board' })).toBe('miniapp')
    expect(mentionGroupKey({ kind: 'desktop-app', path: 'com.apple.Safari' })).toBe('desktop-app')
  })
})

describe('remapIndices', () => {
  it('shifts path indices onto the basename the row renders', () => {
    expect(remapIndices('src/ui/app.ts', 'app.ts', [7, 8, 9])).toEqual([0, 1, 2])
  })

  it('drops indices that fall outside the displayed name', () => {
    expect(remapIndices('src/ui/app.ts', 'app.ts', [0, 1, 7])).toEqual([0])
  })

  it('passes indices through when the display is the whole path', () => {
    expect(remapIndices('app.ts', 'app.ts', [0, 1])).toEqual([0, 1])
  })

  it('gives up rather than highlight the wrong characters', () => {
    expect(remapIndices('src/ui/app.ts', 'other.ts', [0])).toEqual([])
  })
})

describe('buildMentionRows', () => {
  it('ranks within a group, never across them', () => {
    // `@c` prefers Codex among collaborators — both slugs are prefix hits, and
    // the shorter one wins — but capabilities still lead the whole list.
    const rows = buildMentionRows('c', {
      remote: [],
      agentProfiles: [profile('claude-base', 'Claude', 'claude'), profile('codex-base', 'Codex', 'codex')],
      capabilityIds: ['computer'],
    })
    const groups = groupMentionRows(rows)
    expect(groups.map((group) => group.key)).toEqual(['capability', 'agent-profile'])
    expect(groups[1]!.items.map((row) => row.item.path)).toEqual(['codex-base', 'claude-base'])
  })

  it('keeps catalog order for a bare @, and lists the switched-off ones too', () => {
    const rows = buildMentionRows('', { remote: [], agentProfiles: [], capabilityIds: ['debug', 'widget'] })
    expect(rows.map((row) => row.item.path)).toEqual(['computer', 'browser', 'widget', 'debug'])
    expect(rows.filter((row) => row.disabled).map((row) => row.item.path)).toEqual(['computer', 'browser'])
  })

  it('matches an alias but highlights only what the row shows', () => {
    const rows = buildMentionRows('gpt', { remote: [], agentProfiles: [profile('codex-base', 'Codex', 'codex', ['gpt'])] })
    expect(rows.map((row) => row.item.path)).toEqual(['codex-base'])
    expect(rows[0]!.keywordIndices).toEqual([])
  })

  it('gives a capability its id as the keyword and its intent as the detail', () => {
    // The keyword indices are scored against the id. Drawing them over the
    // intent — which is prose — highlights unrelated characters.
    const [row] = buildMentionRows('brow', { remote: [], agentProfiles: [], capabilityIds: ['browser'] })
    expect(row!.keyword).toBe('@browser')
    expect(row!.detail).not.toBe(row!.keyword)
    expect(row!.detail).toContain('browser')
  })

  it('does not repeat a collaborator slug on both lines', () => {
    const [row] = buildMentionRows('codex', { remote: [], agentProfiles: [profile('codex-base', 'Codex', 'codex')] })
    expect(row!.keyword).toBe('@codex')
    expect(row!.detail).toBe('codex-base')
  })

  it('remaps host indices onto the displayed name', () => {
    const rows = buildMentionRows('app', { remote: [file('src/ui/app.ts', [7, 8, 9])], agentProfiles: [] })
    expect(rows[0]!.labelIndices).toEqual([0, 1, 2])
  })

  it('withholds desktop apps until something is typed', () => {
    const app: MentionItem = { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' }
    const desktopApps = (query: string) =>
      buildMentionRows(query, { remote: [app], agentProfiles: [] }).filter((row) => row.item.kind === 'desktop-app')
    expect(desktopApps('')).toEqual([])
    expect(desktopApps('saf')).toHaveLength(1)
  })

  it('de-duplicates a remote row that repeats a built-in', () => {
    const rows = buildMentionRows('', {
      remote: [{ kind: 'builtin', path: 'widget' }, file('src/a.ts')],
      agentProfiles: [],
      capabilityIds: ['widget'],
    })
    expect(rows.filter((row) => row.item.path === 'widget')).toHaveLength(1)
    expect(rows.at(-1)!.item.path).toBe('src/a.ts')
  })

  it('groups in the desktop order regardless of arrival order', () => {
    const rows = buildMentionRows('', {
      remote: [file('src/a.ts'), { kind: 'miniapp', path: 'board' }, { kind: 'agent', path: 'reviewer' }],
      agentProfiles: [profile('codex-base', 'Codex', 'codex')],
      capabilityIds: ['widget'],
    })
    expect(groupMentionRows(rows).map((group) => group.key))
      .toEqual(['capability', 'agent-profile', 'agent', 'miniapp', 'file'])
  })
})

describe('multi-root results', () => {
  it('keeps two same-named files from different roots apart', () => {
    // With additional directories in scope both roots can hold `src/index.ts`.
    // Keying on the path alone silently dropped one of them.
    const rows = buildMentionRows('index', {
      remote: [
        { kind: 'file', path: 'src/index.ts', rootPath: '/work/app' },
        { kind: 'file', path: 'src/index.ts', rootPath: '/work/lib' },
      ],
      agentProfiles: [],
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.detail)).toEqual(['app · src/index.ts', 'lib · src/index.ts'])
  })

  it('leaves single-root rows showing only their path', () => {
    const [row] = buildMentionRows('index', { remote: [{ kind: 'file', path: 'src/index.ts' }], agentProfiles: [] })
    expect(row?.detail).toBe('src/index.ts')
  })
})
