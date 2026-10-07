import { describe, expect, it, vi } from 'vitest'
import { createSessionLinkCache } from './session-link-cache'
import type { SessionLinkMetadataResult } from '@superone/shared/session-link'
const ref = { environmentId: 'A', sessionId: 'same' }
const ok = (target = ref): SessionLinkMetadataResult => ({ status: 'ok', metadata: { ref: target, harness: 'codex', acpAgentId: null } })

describe('session metadata cache', () => {
  it('coalesces before and after dispatch and isolates same IDs on different hosts', async () => {
    let finish!: (result: SessionLinkMetadataResult[]) => void
    const lookup = vi.fn(() => new Promise<SessionLinkMetadataResult[]>(resolve => { finish = resolve }))
    const cache = createSessionLinkCache(lookup)
    const first = cache.get(ref)
    expect(cache.get(ref)).toBe(first)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cache.get(ref)).toBe(first)
    finish([ok()]); expect(await first).toEqual(ok())
    expect(await cache.get(ref)).toEqual(ok())
    expect(lookup).toHaveBeenCalledTimes(1)
    const second = cache.get({ ...ref, environmentId: 'B' })
    await new Promise(resolve => setTimeout(resolve, 0))
    finish([ok({ ...ref, environmentId: 'B' })]); await second
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('resolves retired requests promptly and prevents old results from repopulating the cache', async () => {
    let finish!: (result: SessionLinkMetadataResult[]) => void
    const lookup = vi.fn(() => new Promise<SessionLinkMetadataResult[]>(resolve => { finish = resolve }))
    const cache = createSessionLinkCache(lookup)
    const old = cache.get(ref)
    await new Promise(resolve => setTimeout(resolve, 0))
    const oldFinish = finish
    const listener = vi.fn(); cache.subscribe(listener); cache.clear()
    expect(await old).toEqual({ status: 'unavailable', ref }); expect(listener).toHaveBeenCalledOnce()
    const next = cache.get(ref)
    await new Promise(resolve => setTimeout(resolve, 0))
    oldFinish([ok()]); finish([ok()]); expect(await next).toEqual(ok())
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('batches at 50 refs and limits concurrent lookups to two', async () => {
    const finishes: Array<() => void> = []
    const lookup = vi.fn((refs: typeof ref[]) => new Promise<SessionLinkMetadataResult[]>(resolve => finishes.push(() => resolve(refs.map(ok)))))
    const cache = createSessionLinkCache(lookup)
    const requests = Array.from({ length: 120 }, (_, i) => cache.get({ ...ref, sessionId: String(i) }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(lookup.mock.calls.map(([refs]) => refs.length)).toEqual([50, 50])
    finishes[0](); finishes[1]()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(lookup.mock.calls.map(([refs]) => refs.length)).toEqual([50, 50, 20])
    finishes[2](); await Promise.all(requests)
  })
})
