import { describe, expect, it } from 'vitest'
import { parseMentionEditorSnapshot } from './mention-editor-state'
import { mentionTokenFromItem } from './mention-selection'
import type { MentionItem } from './mentions'

const token = { offset: 2, kind: 'agent-profile', value: 'codex-base', displayName: 'Codex' }
const native = { text: '看 \uFFFC', tokens: [token], start: 3, end: 3, eventCount: 4, composing: false }

describe('native editor boundary', () => {
  it('recovers sendable identity and accepts Android backward selections', () => {
    const snapshot = parseMentionEditorSnapshot({ ...native, start: 3, end: 1 })
    expect(snapshot.start).toBe(1)
    expect(snapshot.end).toBe(3)
    expect(snapshot.document).toEqual([{ text: '看 ' }, { mention: { kind: 'agent-profile', value: 'codex-base', displayName: 'Codex' } }])
  })

  it('reads back every kind the popup can insert as a chip', () => {
    // The insert side and this boundary once kept separate lists; an MCP chip was
    // inserted, then refused here as "Invalid native mention identity".
    const items: MentionItem[] = [
      { kind: 'file', path: 'src/a.ts' }, { kind: 'directory', path: 'src' }, { kind: 'agent', path: 'reviewer' },
      { kind: 'agent-profile', path: 'codex-base', label: 'Codex' }, { kind: 'miniapp', path: 'board', label: 'Board' },
      { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari' }, { kind: 'session', path: 's1', label: 'Ship it' },
      { kind: 'git-ref', path: 'branch:main', label: 'main' }, { kind: 'builtin', path: 'browser' },
      { kind: 'mcp-resource', path: 'bits:cad://parts/hex-bolt', label: 'Hex bolt' },
    ]
    for (const item of items) {
      const chip = mentionTokenFromItem(item)
      expect(chip, item.kind).toBeDefined()
      const snapshot = parseMentionEditorSnapshot({ ...native, tokens: [{ ...chip!, offset: 2 }] })
      expect(snapshot.tokens[0]).toMatchObject(chip!)
    }
  })

  it('rejects a lost span instead of sending an unidentified placeholder', () => {
    expect(() => parseMentionEditorSnapshot({ ...native, tokens: [] })).toThrow('missing its identity')
    expect(() => parseMentionEditorSnapshot({ ...native, tokens: [token, token] })).toThrow('Invalid native mention span')
  })

  it('rejects malformed bridge metadata before updating the draft', () => {
    for (const change of [
      { text: null }, { tokens: null }, { eventCount: -1 }, { composing: 'false' },
      { start: 10 }, { end: 0.5 }, { tokens: [{ ...token, kind: 'unknown' }] },
      { tokens: [{ ...token, value: null }] }, { tokens: [{ ...token, displayName: 123 }] },
    ]) expect(() => parseMentionEditorSnapshot({ ...native, ...change })).toThrow()
  })

  it('retains composition and rejected-command feedback without altering identity', () => {
    const snapshot = parseMentionEditorSnapshot({ ...native, composing: true, rejection: 'stale-or-composing' })
    expect(snapshot.composing).toBe(true)
    expect(snapshot.rejection).toBe('stale-or-composing')
    expect(snapshot.tokens).toEqual([token])
  })
})
