import { describe, expect, it, vi } from 'vitest'
import { PromptEditRelay, type PromptBox, type PromptEditAnswer } from './prompt-edit'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PromptEditRelay', () => {
  it('shows a rewrite of the box the composer still holds', async () => {
    const box: PromptBox = { text: 'a->', cursor: 3 }
    const apply = vi.fn()
    const relay = new PromptEditRelay({ send: async () => ({ text: 'a→', cursor: 2 }), current: () => box, apply })
    relay.edit(box, { key: '>' })
    await flush()
    expect(apply).toHaveBeenCalledWith({ text: 'a→', cursor: 2 })
  })

  it('keeps one edit in flight, collapses the rest into the newest, and drops answers the person outran', async () => {
    let box: PromptBox = { text: 'a', cursor: 1 }
    const answers: Array<ReturnType<typeof deferred<PromptEditAnswer | null>>> = []
    const send = vi.fn(() => {
      const d = deferred<PromptEditAnswer | null>()
      answers.push(d)
      return d.promise
    })
    const apply = vi.fn()
    const relay = new PromptEditRelay({ send, current: () => box, apply })
    relay.edit(box, { key: 'a' })
    box = { text: 'ab', cursor: 2 }
    relay.edit(box, { key: 'b' })
    box = { text: 'abc', cursor: 3 }
    relay.edit(box, { key: 'c' })
    expect(send).toHaveBeenCalledTimes(1)
    answers[0]!.resolve({ text: 'A', cursor: 1 })
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    // Two edits collapsed: no single key made them.
    expect(send).toHaveBeenLastCalledWith({ text: 'abc', cursor: 3, by: 'person' })
    expect(apply).not.toHaveBeenCalled()
    box = { text: 'abcd', cursor: 4 }
    answers[1]!.resolve({ text: 'ABC', cursor: 3 })
    await flush()
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not repaint for an echo, a superseded answer, or an adopted box', async () => {
    const box: PromptBox = { text: 'x', cursor: 1 }
    const apply = vi.fn()
    const answers: PromptEditAnswer[] = [{ text: 'x', cursor: 1 }, { text: 'y', cursor: 1, superseded: true }, { text: 'z', cursor: 1 }]
    const relay = new PromptEditRelay({ send: async () => answers.shift()!, current: () => box, apply })
    relay.edit(box)
    await flush()
    relay.edit(box)
    await flush()
    relay.adopt(box)
    await flush()
    expect(apply).not.toHaveBeenCalled()
  })
})
