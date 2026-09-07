import { requestMentionSearch } from './mention-search'
import { describe, expect, it } from 'vitest'
import { buildAgentMentionTargets } from '@superone/shared/agent-mention-tags'
import { parseUserMentions } from '@superone/shared/user-mention-parser'
import { parseAgentMentionItems, parseMentionItems } from './mentions'
import { buildMentionRows } from './mention-rows'
import { mentionTokenFromItem } from './mention-selection'
import { serializeMentionDocument } from './mention-document'

const targets = buildAgentMentionTargets([
  { providerId: 'codex-work-review', harnessId: 'codex', name: 'Code Reviewer', isBase: false },
  { providerId: 'acp-base', harnessId: 'acp', name: 'ACP', isBase: true, acpAgentId: 'grok-build' },
])

describe('remote provider search to structured message', () => {
  it('preserves host-issued custom and ACP refs through search, selection and serialization', () => {
    const rows = parseAgentMentionItems(targets)
    expect(rows.map((row) => row.path)).toEqual(['codex-work-review', 'acp-base:grok-build'])
    for (const item of rows) {
      const mention = mentionTokenFromItem(item)!
      const segments = parseUserMentions(serializeMentionDocument([{ mention }]))
      expect(segments).toEqual([expect.objectContaining({ kind: 'agent-profile', value: item.path })])
    }
    // Filtering moved to the row builder: an alias matches, a display name matches.
    const matched = (query: string) =>
      buildMentionRows(query, { remote: [], agentProfiles: parseAgentMentionItems(targets) })
        .filter((row) => row.item.kind === 'agent-profile').map((row) => row.item.path)
    expect(matched('xai')[0]).toBe('acp-base:grok-build')
    expect(matched('REVIEW')[0]).toBe('codex-work-review')
  })
  it('queries host targets before a chat session exists and selects their actual refs', async () => {
    const commands: unknown[] = []
    const result = await requestMentionSearch({ request: async (command: unknown) => {
      commands.push(command)
      return { agentTargets: targets, items: [] }
    } } as never, '/workspace/project', 'xai')
    expect(commands).toEqual([expect.objectContaining({ type: 'search_mentions', projectPath: '/workspace/project', query: 'xai' })])
    expect(commands[0]).not.toHaveProperty('sessionId')
    const item = buildMentionRows('xai', { remote: [], agentProfiles: parseAgentMentionItems(result.agentTargets) })
      .find((row) => row.item.kind === 'agent-profile')!.item
    expect(mentionTokenFromItem(item)).toEqual({ kind: 'agent-profile', value: 'acp-base:grok-build', displayName: 'Grok' })
  })
  it('keeps same-named project agents distinct and supports older hosts without targets', () => {
    const resource = parseMentionItems([{ kind: 'agent', path: 'codex' }])
    const rows = buildMentionRows('', { remote: resource, agentProfiles: parseAgentMentionItems(targets) })
    // A project agent named `codex` is not the Codex collaborator, and the two
    // land in different groups.
    expect(rows.filter((row) => row.item.kind === 'agent').map((row) => row.item)).toEqual(resource)
    expect(mentionTokenFromItem(resource[0]!)?.kind).toBe('agent')
    expect(buildMentionRows('codex', { remote: [], agentProfiles: parseAgentMentionItems(undefined) })).toEqual([])
  })
  it('rejects malformed target records without losing valid host identities', () => {
    expect(parseAgentMentionItems([null, {}, { ref: '', slug: 'codex', displayName: 'Codex' }, ...targets])).toHaveLength(2)
  })
  it('accepts bounded PNG app artwork and rejects untrusted image payloads', () => {
    const png = 'cG5n'
    const rows = parseMentionItems([
      { kind: 'miniapp', path: 'board', label: 'Board', iconDataUri: `data:image/png;base64,${png}` },
      { kind: 'desktop-app', path: 'com.example.Editor', iconDataUri: 'https://example.com/icon.png' },
      { kind: 'desktop-app', path: 'com.example.Svg', iconDataUri: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { kind: 'desktop-app', path: 'com.example.Huge', iconDataUri: `data:image/png;base64,${'A'.repeat(256_001)}` },
    ])
    expect(rows[0]?.iconPng).toBe(png)
    expect(rows.slice(1).every((row) => row.iconPng === undefined)).toBe(true)
  })
})
