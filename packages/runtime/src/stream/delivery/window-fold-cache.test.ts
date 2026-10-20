import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { processTurn, textMessage } from '@superone/shared/transcript-window/window-fixtures'
import { WindowViews } from './window-views'

const budget = { maxBytes: 1024 * 1024, maxFragments: 64, targetChars: 100_000 }

describe('fold page cache', () => {
  it('does not plan a reparsed copy of a message it already folded', () => {
    const views = new WindowViews()
    const message = processTurn('a', 20)
    const selected = views.serve({
      sessionId: 's', holder: 'phone', messages: [textMessage('u', 'user', 'hi'), message],
      request: { folds: true }, budget,
    })
    const fold = selected.messages.find((row) => row.id === 'a')?.fragments.find((fragment) => fragment.body?.kind === 'fold')
    if (!fold?.body || fold.body.kind !== 'fold') throw new Error('expected a fold')
    const planned = views.plannedFolds('s')
    const clone = JSON.parse(JSON.stringify(message)) as ChatMessage
    const page = views.fold('s', clone, { fold: fold.key, revision: fold.body.revision }, budget)
    expect(page.fragments.length).toBeGreaterThan(0)
    expect(views.plannedFolds('s')).toBe(planned)
    const changed = { ...clone, content: [...clone.content, { type: 'text' as const, text: 'more' }] }
    try {
      views.fold('s', changed, { fold: fold.key, revision: fold.body.revision }, budget)
    } catch (error) {
      expect(error).toMatchObject({ code: expect.stringMatching(/not_found|failed_precondition/) })
    }
    expect(views.plannedFolds('s')).toBe(planned + 1)
  })

  it('keeps plans only for messages a window holds, or the one a windowless read pages', () => {
    const a = processTurn('a', 20)
    const b = processTurn('b', 20)
    const foldOf = (message: ChatMessage) => {
      const served = new WindowViews().serve({ sessionId: 's', holder: 'x', messages: [message], request: { folds: true }, budget })
      const fold = served.messages[0].fragments.find((fragment) => fragment.body?.kind === 'fold')
      if (!fold?.body || fold.body.kind !== 'fold') throw new Error('expected a fold')
      return { fold: fold.key, revision: fold.body.revision }
    }
    const clone = (message: ChatMessage) => JSON.parse(JSON.stringify(message)) as ChatMessage

    const spare = new WindowViews()
    spare.fold('s', clone(a), foldOf(a), budget)
    spare.fold('s', clone(a), foldOf(a), budget)
    expect(spare.plannedFolds('s')).toBe(1)
    spare.fold('s', clone(b), foldOf(b), budget)
    spare.fold('s', clone(a), foldOf(a), budget)
    expect(spare.plannedFolds('s')).toBe(3)

    const held = new WindowViews()
    held.serve({ sessionId: 's', holder: 'phone', messages: [a, b], request: { folds: true }, budget })
    const planned = held.plannedFolds('s')
    held.serve({ sessionId: 's', holder: 'phone', messages: [b], request: { folds: true }, budget })
    held.fold('s', clone(b), foldOf(b), budget)
    expect(held.plannedFolds('s')).toBe(planned)
    held.fold('s', clone(a), foldOf(a), budget)
    expect(held.plannedFolds('s')).toBe(planned + 1)
  })
})
