import { describe, expect, it } from 'vitest'
import type { ChatMessage, ContentBlock } from '../agent-types'
import { contentKeys, contentKeySpan } from '../transcript-boundary'
import { FOLD_KEY_PREFIX, foldMessageFragments, foldRevision, selectFoldPage, type FoldRange } from './folds'
import { fragmentMessage } from './fragment-message'
import { DEFAULT_WINDOW_BUDGET } from './select-window'
import { FRAGMENT_TEXT_CHARS } from './text-cuts'

const call = (id: string): ContentBlock => ({ type: 'tool_use', toolName: 'Bash', toolUseId: id, input: '{}', status: 'complete' })
const result = (id: string): ContentBlock => ({ type: 'tool_result', toolUseId: id, summary: 'ok' })
const summary: FoldRange['summary'] = { segments: 3, toolCalls: 3, files: [], added: 0, removed: 0, contentKey: 'tool:a' }

function message(content: ContentBlock[]): ChatMessage {
  return {
    id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content,
    attachments: [{ id: 'img', name: 'a.png', mediaType: 'image/png', size: 1 } as never],
  }
}

describe('folds', () => {
  it('cuts each range down to one fold that hashes what it hides', () => {
    const fragments = fragmentMessage(message([{ type: 'text', text: 'start' }, call('a'), result('a'), call('b'), result('b'), { type: 'text', text: 'end' }]))
    const folded = foldMessageFragments(fragments, [{ start: 1, end: 4, summary }])
    const keys = fragments.fragments.map((fragment) => fragment.key)
    expect(folded.fragments.map((fragment) => fragment.key)).toEqual([keys[0], keys[1], `${FOLD_KEY_PREFIX}tool:a`, keys[6]])
    const fold = folded.fragments[2]
    const inner = folded.folds.get(fold.key)!
    expect(inner.entries.map((fragment) => fragment.key)).toEqual(fragments.fragments.slice(2, 6).map((fragment) => fragment.key))
    expect(inner.blocks).toEqual([1, 2, 3, 4])
    expect(fold.body).toEqual({ kind: 'fold', revision: foldRevision(inner.entries), summary: { ...summary, fragments: 4 } })
    expect(fold.chars).toBe(0)
    expect(folded.blocks).toEqual([-1, 0, 1, 5])
  })

  it('pages a fold and keeps each call with its result', () => {
    const fragments = fragmentMessage(message(['a', 'b', 'c'].flatMap((id) => [call(id), result(id)])))
    const inner = foldMessageFragments(fragments, [{ start: 0, end: 5, summary }]).folds.get(`${FOLD_KEY_PREFIX}tool:a`)!
    const budget = { ...DEFAULT_WINDOW_BUDGET, maxFragments: 3 }
    expect(selectFoldPage(inner, undefined, budget)).toEqual({ start: 0, end: 4 })
    expect(selectFoldPage(inner, inner.entries[3].key, budget)).toEqual({ start: 4, end: 6 })
    expect(selectFoldPage(inner, inner.entries[5].key, budget)).toEqual({ start: 6, end: 6 })
    expect(selectFoldPage(inner, 'gone', budget)).toBeNull()
  })

  it('finishes a sliced text block so the rest summary starts at the next one', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'x'.repeat(FRAGMENT_TEXT_CHARS * 2 + 10) },
      call('a'), result('a'), call('b'), result('b'),
      { type: 'text', text: 'tail' },
    ]
    const fragments = fragmentMessage(message(content))
    const inner = foldMessageFragments(fragments, [{ start: 0, end: 5, summary }]).folds.values().next().value!
    const textSlices = inner.blocks.filter((block) => block === 0).length
    expect(textSlices).toBeGreaterThan(1)
    const budget = { ...DEFAULT_WINDOW_BUDGET, maxFragments: 1 }
    const page = selectFoldPage(inner, undefined, budget)!
    expect(page).toEqual({ start: 0, end: textSlices })
    expect(inner.blocks[page.end]).not.toBe(inner.blocks[page.end - 1])
    const keys = contentKeys(content)
    const shown = new Set(inner.blocks.slice(page.start, page.end).map((block) => keys[block]))
    const rest = contentKeySpan(content, keys, inner.blocks[page.end], inner.blocks[inner.blocks.length - 1])
    expect(shown.has(rest.contentKey)).toBe(false)
    expect(rest.contentKey).toBe(keys[1])
    expect(rest.keyCounts?.['text:']).toBe(1)
  })

  it('ends a page before a sliced block it would cut, and reads that block on its own page', () => {
    const content: ContentBlock[] = [
      call('a'), result('a'),
      { type: 'text', text: 'x'.repeat(FRAGMENT_TEXT_CHARS * 3 + 10) },
      call('b'), result('b'),
    ]
    const fragments = fragmentMessage(message(content))
    const inner = foldMessageFragments(fragments, [{ start: 0, end: 4, summary }]).folds.values().next().value!
    const textSlices = inner.blocks.filter((block) => block === 2).length
    expect(textSlices).toBeGreaterThan(2)
    const budget = { ...DEFAULT_WINDOW_BUDGET, maxFragments: 3 }
    expect(selectFoldPage(inner, undefined, budget)).toEqual({ start: 0, end: 2 })
    expect(selectFoldPage(inner, inner.entries[1].key, budget)).toEqual({ start: 2, end: 2 + textSlices })
  })

  it('reads a folded turn with the content keys of the whole one', () => {
    const content: ContentBlock[] = [{ type: 'thinking', thinking: '' }, call('a'), result('a'), { type: 'thinking', thinking: '' }, { type: 'text', text: 'end' }]
    const keys = contentKeys(content)
    const folded: ContentBlock[] = [
      { type: 'notice', id: 'f', level: 'info', kind: 'fold', text: '',
        fold: { ...summary, fragments: 3, messageId: 'm', key: 'fold:x', revision: 'r', contentKey: keys[0], keyCounts: { 'thinking:': 1 } } },
      content[3], content[4],
    ]
    expect(contentKeys(folded)).toEqual([keys[0], keys[3], keys[4]])
  })
})
