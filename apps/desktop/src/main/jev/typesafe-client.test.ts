import { describe, expect, it, vi } from 'vitest'
import { assertWithinBudget, createJevClient, JEV_MODEL, JevError, readNoul, validateChoice } from './typesafe-client'

const OPTIONS = ['a', 'b', 'c']

describe('validateChoice', () => {
  it('accepts a well-formed answer and rejects every malformed shape', () => {
    const good = { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.2, c: 0.1 }, confidence: 0.8 }
    expect(validateChoice(good, OPTIONS)).toMatchObject({ choice: 'a', confidence: 0.8 })
    expect(validateChoice({ ...good, choice: 'z' }, OPTIONS)).toBeNull()
    expect(validateChoice({ ...good, probabilities: { a: 0.7, b: 0.3 } }, OPTIONS)).toBeNull()
    expect(validateChoice({ ...good, probabilities: { a: 0.5, b: 0.5, c: 0.5 } }, OPTIONS)).toBeNull()
    // The chosen option must carry the top probability.
    expect(validateChoice({ ...good, choice: 'c' }, OPTIONS)).toBeNull()
    expect(validateChoice({ ...good, confidence: 1.5 }, OPTIONS)).toBeNull()
    expect(validateChoice(null, OPTIONS)).toBeNull()
  })

  it('reads a noul probability or nothing', () => {
    expect(readNoul({ type: 'noul', noul: 0.42 })).toBe(0.42)
    expect(readNoul({ type: 'noul', noul: 'high' })).toBeNull()
    expect(readNoul(undefined)).toBeNull()
  })
})

describe('createJevClient', () => {
  const ok = (answers: unknown) => new Response(JSON.stringify({ answers, model: JEV_MODEL, usage: { input_tokens: 10 } }), { status: 200 })

  it('posts the pinned model with a bearer key and returns answers', async () => {
    const fetch = vi.fn(async () => ok({ q: { type: 'noul', noul: 0.5 } }))
    const client = createJevClient({ apiKey: 'ts-secret', fetch })
    const res = await client.ask({ state: { x: 1 }, questions: { q: { type: 'noul', instructions: 'is x one?' } } })
    expect(res.answers.q).toEqual({ type: 'noul', noul: 0.5 })
    expect(res.model).toBe(JEV_MODEL)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/v1/systemone')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ts-secret')
    expect(JSON.parse(init.body as string).model).toBe(JEV_MODEL)
  })

  it('retries 429 with backoff and surfaces 401 as a key problem', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
        .mockResolvedValueOnce(ok({}))
      const client = createJevClient({ apiKey: 'k', fetch })
      const pending = client.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } })
      await vi.advanceTimersByTimeAsync(600)
      await expect(pending).resolves.toMatchObject({ answers: {} })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
    const denied = createJevClient({ apiKey: 'bad', fetch: vi.fn(async () => new Response('', { status: 401 })) })
    await expect(denied.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } })).rejects.toMatchObject({ status: 401 })
  })

  it('honours an abort signal', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const client = createJevClient({ apiKey: 'k', fetch })
    const controller = new AbortController()
    const pending = client.ask({ state: 's', questions: { q: { type: 'noul', instructions: 'i' } } }, controller.signal)
    controller.abort(new Error('user stopped'))
    await expect(pending).rejects.toThrow('user stopped')
  })

  it('refuses a request over the documented budget before sending it', () => {
    const state = 'x'.repeat(4 * 33_000)
    expect(() => assertWithinBudget({ state, questions: { q: { type: 'noul', instructions: 'i' } } })).toThrow(JevError)
  })
})
