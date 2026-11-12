import { describe, expect, it, vi } from 'vitest'
import { OfficePreviewTooLargeError, readOfficePreviewBytes } from './office-preview-bytes'

const signal = () => new AbortController().signal

function response(body: unknown, init?: { ok?: boolean; length?: string | null }): Response {
  const headers = {
    get(name: string) {
      if (name.toLowerCase() !== 'content-length') return null
      return init?.length === undefined ? null : init.length
    },
  }
  return { ok: init?.ok ?? true, headers, body, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as unknown as Response
}

describe('readOfficePreviewBytes', () => {
  it('returns the bytes when the body stays under the cap', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetcher = vi.fn(async () => response(streamOf([bytes]), { length: '4' }))
    const buffer = await readOfficePreviewBytes('local-file:///a.docx', signal(), fetcher, 8)
    expect(new Uint8Array(buffer)).toEqual(bytes)
  })

  it('rejects an advertised length over the cap before reading the body', async () => {
    let read = false
    const body = {
      getReader: () => ({ read: async () => { read = true; return { done: true, value: undefined } }, cancel: async () => {} }),
      cancel: async () => {},
    }
    const fetcher = vi.fn(async () => response(body, { length: '9' }))
    await expect(readOfficePreviewBytes('local-file:///a.docx', signal(), fetcher, 8)).rejects.toBeInstanceOf(OfficePreviewTooLargeError)
    expect(read).toBe(false)
  })

  it('cancels a stream that grows past the cap with no length header', async () => {
    let cancelled = false
    const body = {
      getReader: () => {
        const chunks = [new Uint8Array(5), new Uint8Array(5)]
        let i = 0
        return {
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
          cancel: async () => { cancelled = true },
        }
      },
    }
    const fetcher = vi.fn(async () => response(body, { length: null }))
    await expect(readOfficePreviewBytes('local-file:///a.docx', signal(), fetcher, 8)).rejects.toBeInstanceOf(OfficePreviewTooLargeError)
    expect(cancelled).toBe(true)
  })

  it('rejects a bodyless response whose bytes exceed the cap', async () => {
    const fetcher = vi.fn(async () => response(null, { length: null }))
    await expect(readOfficePreviewBytes('local-file:///a.docx', signal(), fetcher, 2)).rejects.toBeInstanceOf(OfficePreviewTooLargeError)
  })

  it('does not fetch once the signal is already aborted', async () => {
    const fetcher = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(readOfficePreviewBytes('local-file:///a.docx', controller.signal, fetcher, 8)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a failed response', async () => {
    const fetcher = vi.fn(async () => response(null, { ok: false }))
    await expect(readOfficePreviewBytes('local-file:///a.docx', signal(), fetcher, 8)).rejects.toThrow(/could not be read/)
  })
})

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
