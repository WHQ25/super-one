import { describe, expect, it } from 'vitest'
import { buildMentionRows, groupMentionRows, mentionDisplayName, mentionGroupKey, MENTION_GROUP_ORDER, shiftIndices } from './mention-rows'
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

describe('what a file row shows', () => {
  it('shows the whole relative path, as the desktop does', () => {
    // Two files called `index.ts` are indistinguishable by basename, which is
    // the case a path is there for.
    expect(mentionDisplayName({ kind: 'file', path: 'src/ui/app.ts' })).toBe('src/ui/app.ts')
  })

  it('drops only the directory the query already names', () => {
    expect(mentionDisplayName({ kind: 'file', path: 'src/ui/app.ts' }, 'src/ui/')).toBe('app.ts')
  })

  it('prefers a label the host supplied over any path', () => {
    expect(mentionDisplayName({ kind: 'session', path: 'sess-1', label: 'Ship it' }, 'src/')).toBe('Ship it')
  })
})

describe('shiftIndices', () => {
  it('moves host indices onto the shortened display', () => {
    expect(shiftIndices([7, 8, 9], 7, 6)).toEqual([0, 1, 2])
  })

  it('drops what falls outside rather than colouring the wrong characters', () => {
    expect(shiftIndices([0, 1, 7], 7, 6)).toEqual([0])
  })

  it('passes indices through when nothing was dropped', () => {
    expect(shiftIndices([0, 1], 0, 6)).toEqual([0, 1])
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
    expect(rows.map((row) => row.item.path)).toEqual(['computer', 'browser', 'widget', 'debug', 'session', 'git', 'gh'])
    // Unknown git availability stays enterable until the host answers, matching the grammar gate.
    expect(rows.filter((row) => row.disabled).map((row) => row.item.path)).toEqual(['computer', 'browser'])
  })

  it('matches an alias but highlights only what the row shows', () => {
    const rows = buildMentionRows('gpt', { remote: [], agentProfiles: [profile('codex-base', 'Codex', 'codex', ['gpt'])] })
    expect(rows.map((row) => row.item.path)).toEqual(['codex-base'])
    expect(rows[0]!.inlineIndices).toEqual([])
  })

  it('shows a working capability as one line: name and handle', () => {
    // The desktop prints no description here. Prose under every built-in made
    // the list twice as tall for something the name already said.
    const [row] = buildMentionRows('brow', { remote: [], agentProfiles: [], capabilityIds: ['browser'] })
    expect(row).toMatchObject({ label: 'Super Browser', inline: '@browser' })
    expect(row!.hint).toBeUndefined()
  })

  it('replaces the handle with where to switch a capability back on', () => {
    // The one row that earns a second line, and it is actionable rather than
    // descriptive.
    const [row] = buildMentionRows('brow', { remote: [], agentProfiles: [], capabilityIds: [] })
    expect(row).toMatchObject({ disabled: true, badge: { text: 'Off', tone: 'muted' } })
    expect(row!.hint).toBe('Enable Browser CDP in the desktop settings')
    expect(row!.inline).toBeUndefined()
  })

  it('shows a collaborator as name and slug, without its ref', () => {
    const [row] = buildMentionRows('codex', { remote: [], agentProfiles: [profile('codex-base', 'Codex', 'codex')] })
    expect(row).toMatchObject({ label: 'Codex', inline: '@codex' })
    expect(row!.trailing).toBeUndefined()
  })

  it('shifts host indices onto the path it displays', () => {
    const rows = buildMentionRows('app', { remote: [file('src/ui/app.ts', [7, 8, 9])], agentProfiles: [] })
    expect(rows[0]!.label).toBe('src/ui/app.ts')
    expect(rows[0]!.labelIndices).toEqual([7, 8, 9])
    const scoped = buildMentionRows('app', { remote: [file('src/ui/app.ts', [7, 8, 9])], agentProfiles: [], scopeDir: 'src/ui/' })
    expect(scoped[0]!.label).toBe('app.ts')
    expect(scoped[0]!.labelIndices).toEqual([0, 1, 2])
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
    // The checkout goes at the end of the line, where a session's project goes.
    expect(rows.map((row) => row.trailing)).toEqual(['app', 'lib'])
  })

  it('leaves single-root rows showing only their path', () => {
    const [row] = buildMentionRows('index', { remote: [{ kind: 'file', path: 'src/index.ts' }], agentProfiles: [] })
    expect(row).toMatchObject({ label: 'src/index.ts' })
    expect(row?.trailing).toBeUndefined()
  })
})

describe('what each kind puts on its one line', () => {
  // The desktop's rows are `flex items-center` — one line each, with what
  // distinguishes the row pushed to its end. Mobile gave every kind a second
  // line, which doubled the list's height to repeat the first.
  const only = (item: MentionItem, query = '') =>
    buildMentionRows(query, { remote: [item], agentProfiles: [], scoped: true })[0]!

  it('puts a session in a project and a harness at the end of its title', () => {
    const row = only({ kind: 'session', path: 'sess-1', label: 'Ship it', description: 'super-one', badge: 'claude' })
    expect(row).toMatchObject({ label: 'Ship it', trailing: 'super-one', badge: { text: 'claude', tone: 'muted' } })
    expect(row.hint).toBeUndefined()
  })

  it('shows a scope choice with its hint beside the name, not under it', () => {
    const row = only({ kind: 'session-project', path: 'relay', label: 'relay', description: '/work/relay' })
    expect(row).toMatchObject({ label: 'relay', inline: '/work/relay' })
    expect(row.trailing).toBeUndefined()
  })

  it('badges a project agent with its model, and says inherit when it has none', () => {
    expect(only({ kind: 'agent', path: 'reviewer', badge: 'claude-opus-5' }).badge)
      .toEqual({ text: 'claude-opus-5', tone: 'muted' })
    expect(only({ kind: 'agent', path: 'reviewer' }).badge).toEqual({ text: 'inherit', tone: 'muted' })
  })

  it('marks a desktop app as reachable only through Computer Use', () => {
    // Desktop apps need a query at all, which is asserted separately.
    expect(only({ kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' }, 'saf').badge)
      .toEqual({ text: 'Computer Use', tone: 'accent' })
  })

  it('leaves a mini-app as just its name', () => {
    const row = only({ kind: 'miniapp', path: 'board', label: 'Board', description: 'Kanban mini-app' })
    expect(row.label).toBe('Board')
    expect(row.inline ?? row.trailing ?? row.badge).toBeUndefined()
  })
})
