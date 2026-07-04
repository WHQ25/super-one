import { describe, expect, it } from 'vitest'
import { buildSlashCommands, extractModeFromSuggestions, findCheckpointTarget, remapMessagesForFork } from './chat-helpers'
import type { ChatMessage, SlashCommandInfo } from '@superone/shared/agent-types'

function cmd(name: string, description = ''): SlashCommandInfo {
  return { name, description, argumentHint: '', isSkill: false }
}

describe('buildSlashCommands', () => {
  it('tags global commands as isSkill when matching user/project skills', () => {
    const global = [cmd('context'), cmd('commit')]
    const userSkills = [cmd('context', 'user-level context skill')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    const context = result.find((c) => c.name === 'context')!
    expect(context.isSkill).toBe(true)
    // Non-matching global command stays non-skill
    const commit = result.find((c) => c.name === 'commit')!
    expect(commit.isSkill).toBe(false)
  })

  it('adds extra skills/commands not in globalSlashCommands', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('my-skill', 'custom skill')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    expect(result.find((c) => c.name === 'my-skill')).toBeTruthy()
  })

  it('deduplicates skills that exist in both user and project scope', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('tdd', 'user tdd')]
    const projectSkills = [cmd('tdd', 'project tdd')]
    const result = buildSlashCommands(global, userSkills, [], projectSkills, [])

    const tddEntries = result.filter((c) => c.name === 'tdd')
    expect(tddEntries).toHaveLength(1)
    // User skill takes priority (appears first in the merge)
    expect(tddEntries[0].description).toBe('user tdd')
  })

  it('deduplicates across all four extra sources', () => {
    const global: SlashCommandInfo[] = []
    const userSkills = [cmd('foo')]
    const userCommands = [cmd('foo')]
    const projectSkills = [cmd('foo')]
    const projectCommands = [cmd('foo')]
    const result = buildSlashCommands(global, userSkills, userCommands, projectSkills, projectCommands)

    expect(result.filter((c) => c.name === 'foo')).toHaveLength(1)
  })

  it('merges argumentHint from skill when global command has none', () => {
    const global = [cmd('release')]
    const projectSkills: SlashCommandInfo[] = [
      { name: 'release', description: 'Release app', argumentHint: '[channel] [bump]', isSkill: true },
    ]
    const result = buildSlashCommands(global, [], [], projectSkills, [])

    const release = result.find((c) => c.name === 'release')!
    expect(release.isSkill).toBe(true)
    expect(release.argumentHint).toBe('[channel] [bump]')
  })

  it('does not add extras that already exist in globalSlashCommands', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('context', 'overridden')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    const contextEntries = result.filter((c) => c.name === 'context')
    expect(contextEntries).toHaveLength(1)
    expect(contextEntries[0].description).toBe('')
  })

  it('drops skills present in disabledSkills set from tagged commands', () => {
    const global = [cmd('release'), cmd('commit')]
    const userSkills: SlashCommandInfo[] = [
      { name: 'release', description: 'release skill', argumentHint: '', isSkill: true },
    ]
    const result = buildSlashCommands(global, userSkills, [], [], [], new Set(['release']))

    expect(result.find((c) => c.name === 'release')).toBeUndefined()
    expect(result.find((c) => c.name === 'commit')).toBeTruthy()
  })

  it('drops skills present in disabledSkills set from extra commands', () => {
    const global: SlashCommandInfo[] = []
    const projectSkills: SlashCommandInfo[] = [
      { name: 'release', description: 'r', argumentHint: '', isSkill: true },
    ]
    const result = buildSlashCommands(global, [], [], projectSkills, [], new Set(['release']))

    expect(result.find((c) => c.name === 'release')).toBeUndefined()
  })

  it('keeps non-skill commands of the same name when disabled set has the name', () => {
    const global: SlashCommandInfo[] = []
    const userCommands: SlashCommandInfo[] = [
      { name: 'release', description: 'plain command', argumentHint: '', isSkill: false },
    ]
    const result = buildSlashCommands(global, [], userCommands, [], [], new Set(['release']))

    const release = result.find((c) => c.name === 'release')
    expect(release).toBeTruthy()
    expect(release?.isSkill).toBe(false)
  })

  it('replaces the SDK built-in /clear (dropping its [name] hint) with a local-only clear', () => {
    const global: SlashCommandInfo[] = [
      { name: 'clear', description: 'Clear conversation history and free up context', argumentHint: '[name]', isSkill: false },
    ]
    const result = buildSlashCommands(global, [], [], [], [])

    const clears = result.filter((c) => c.name === 'clear')
    expect(clears).toHaveLength(1)
    expect(clears[0].argumentHint).toBe('')
    expect(clears[0].isSkill).toBe(false)
  })
})

function msg(id: string, role: 'user' | 'assistant', extra?: Partial<ChatMessage>): ChatMessage {
  return { id, role, content: [], status: 'complete', createdAt: '', providerId: 'claude', ...extra }
}

describe('findCheckpointTarget', () => {
  it('returns the user message before the matching assistant message', () => {
    const msgs = [msg('u1', 'user'), msg('a1', 'assistant'), msg('u2', 'user'), msg('a2', 'assistant')]
    expect(findCheckpointTarget(msgs, 'a2')).toBe(2)
    expect(findCheckpointTarget(msgs, 'a1')).toBe(0)
  })

  it('falls back to the last user message when assistant ID is not found', () => {
    const msgs = [msg('u1', 'user'), msg('u2', 'user')]
    expect(findCheckpointTarget(msgs, 'unknown')).toBe(1)
  })

  it('returns -1 when there are no user messages', () => {
    const msgs = [msg('a1', 'assistant')]
    expect(findCheckpointTarget(msgs, 'unknown')).toBe(-1)
  })

  it('returns -1 for empty messages', () => {
    expect(findCheckpointTarget([], 'a1')).toBe(-1)
  })

  it('skips assistant-only messages between user and target', () => {
    const msgs = [msg('u1', 'user'), msg('a1', 'assistant'), msg('a2', 'assistant')]
    expect(findCheckpointTarget(msgs, 'a2')).toBe(0)
  })
})

describe('remapMessagesForFork', () => {
  it('prefixes each message ID with the forked session ID', () => {
    const msgs = [msg('abc', 'user'), msg('def', 'assistant')]
    const result = remapMessagesForFork(msgs, 'fork-1')
    expect(result.map((m) => m.id)).toEqual(['fork-1_abc', 'fork-1_def'])
  })

  it('preserves all other message properties', () => {
    const original = msg('abc', 'user', { checkpointId: 'cp1' })
    const [result] = remapMessagesForFork([original], 'fork-1')
    expect(result.role).toBe('user')
    expect(result.checkpointId).toBe('cp1')
  })

  it('does not mutate original messages', () => {
    const original = msg('abc', 'user')
    remapMessagesForFork([original], 'fork-1')
    expect(original.id).toBe('abc')
  })
})

describe('extractModeFromSuggestions', () => {
  it('returns the mode when a setMode suggestion is selected', () => {
    const suggestions = [
      { type: 'addRules', rules: [] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ]
    expect(extractModeFromSuggestions(suggestions, [1])).toBe('acceptEdits')
  })

  it('returns undefined when no setMode suggestion is selected', () => {
    const suggestions = [
      { type: 'addRules', rules: [] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ]
    expect(extractModeFromSuggestions(suggestions, [0])).toBeUndefined()
  })

  it('returns undefined when suggestions is undefined', () => {
    expect(extractModeFromSuggestions(undefined, [0])).toBeUndefined()
  })

  it('returns undefined when selectedIndices is empty', () => {
    const suggestions = [{ type: 'setMode', mode: 'acceptEdits' }]
    expect(extractModeFromSuggestions(suggestions, [])).toBeUndefined()
  })

  it('returns the last setMode when multiple setMode suggestions are selected', () => {
    const suggestions = [
      { type: 'setMode', mode: 'acceptEdits' },
      { type: 'setMode', mode: 'bypassPermissions' },
    ]
    expect(extractModeFromSuggestions(suggestions, [0, 1])).toBe('bypassPermissions')
  })

  it('ignores out-of-bounds indices', () => {
    const suggestions = [{ type: 'setMode', mode: 'acceptEdits' }]
    expect(extractModeFromSuggestions(suggestions, [5])).toBeUndefined()
  })
})
