import { describe, expect, it, vi } from 'vitest'
import { replyToHostRequest, type HostRequestContext } from './host-requests'

function ctx(over: Partial<HostRequestContext> = {}): HostRequestContext {
  return { draftText: '', isIdle: true, isDeciding: false, setDraft: vi.fn(), suggest: vi.fn(), copy: vi.fn(async () => true), ...over }
}

describe('replyToHostRequest', () => {
  it('reads the draft with the composer caret, or its end without one', async () => {
    expect(await replyToHostRequest(ctx({ draftText: 'abc' }), { kind: 'promptRead' })).toEqual({ kind: 'promptRead', text: 'abc', cursor: 3 })
    const composer = { caret: () => 1, fill: vi.fn() }
    expect(await replyToHostRequest(ctx({ draftText: 'abc', composer }), { kind: 'promptRead' })).toEqual({ kind: 'promptRead', text: 'abc', cursor: 1 })
  })

  it('fills through the composer, keeping decorations', async () => {
    const composer = { caret: () => 0, fill: vi.fn() }
    const reply = await replyToHostRequest(ctx({ composer }), { kind: 'promptFill', text: 'x', mode: 'insert', decorations: [{ start: 0, end: 1, bold: true }] })
    expect(reply).toEqual({ kind: 'promptFill', filled: true })
    expect(composer.fill).toHaveBeenCalledWith('x', 'insert', [{ start: 0, end: 1, bold: true }])
  })

  it('fills the stored draft when no composer shows the session', async () => {
    const c = ctx({ draftText: 'a' })
    await replyToHostRequest(c, { kind: 'promptFill', text: 'b', mode: 'append' })
    await replyToHostRequest(c, { kind: 'promptFill', text: 'c', mode: 'replace' })
    expect(c.setDraft).toHaveBeenNthCalledWith(1, 'ab')
    expect(c.setDraft).toHaveBeenNthCalledWith(2, 'c')
  })

  it('refuses to fill while a decision prompt holds the keys, or without the session', async () => {
    const c = ctx({ isDeciding: true })
    expect(await replyToHostRequest(c, { kind: 'promptFill', text: 'x', mode: 'replace' })).toEqual({ kind: 'promptFill', filled: false })
    expect(c.setDraft).not.toHaveBeenCalled()
    expect(await replyToHostRequest(null, { kind: 'promptFill', text: 'x', mode: 'replace' })).toEqual({ kind: 'promptFill', filled: false })
  })

  it('suggests only into an empty, idle composer', async () => {
    expect(await replyToHostRequest(ctx(), { kind: 'promptSuggest', text: 's' })).toEqual({ kind: 'promptSuggest', shown: true })
    expect(await replyToHostRequest(ctx({ draftText: 'typing' }), { kind: 'promptSuggest', text: 's' })).toEqual({ kind: 'promptSuggest', shown: false })
    expect(await replyToHostRequest(ctx({ isIdle: false }), { kind: 'promptSuggest', text: 's' })).toEqual({ kind: 'promptSuggest', shown: false })
  })

  it('answers copy false when the clipboard write fails instead of throwing', async () => {
    const reply = await replyToHostRequest(ctx({ copy: async () => { throw new Error('denied') } }), { kind: 'copy', plugin: 'p', text: 't' })
    expect(reply).toEqual({ kind: 'copy', copied: false })
  })
})
