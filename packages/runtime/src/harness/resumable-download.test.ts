import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadResumableToFile,
  parseContentRange,
  resetDestPathLocksForTests,
} from './resumable-download'
import { sha256Hex } from './tarball-fetch'
import type { HttpFetch } from './tarball-fetch'

describe('parseContentRange', () => {
  it('parses total', () => {
    expect(parseContentRange('bytes 100-199/500')).toEqual({
      start: 100,
      end: 199,
      total: 500,
    })
  })
})

describe('downloadResumableToFile', () => {
  let root: string

  afterEach(() => {
    resetDestPathLocksForTests()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resumes with Range when partial exists', async () => {
    root = mkdtempSync(join(tmpdir(), 'so-resume-'))
    const full = Buffer.alloc(500, 9)
    const dest = join(root, 'a.partial')
    writeFileSync(dest, full.subarray(0, 200))

    let sawRange: string | undefined
    const httpFetch: HttpFetch = async (_url, init) => {
      const h = init?.headers as Record<string, string> | undefined
      sawRange = h?.Range
      const start = 200
      const tail = full.subarray(start)
      return new Response(tail, {
        status: 206,
        headers: {
          'content-length': String(tail.byteLength),
          'content-range': `bytes ${start}-${full.byteLength - 1}/${full.byteLength}`,
        },
      })
    }

    const digests = await downloadResumableToFile(httpFetch, 'https://example.test/a.tgz', dest)
    expect(sawRange).toBe('bytes=200-')
    expect(readFileSync(dest).equals(full)).toBe(true)
    expect(digests.sha256Hex).toBe(sha256Hex(full))
  })

  it('keeps partial after mid-download failure', async () => {
    root = mkdtempSync(join(tmpdir(), 'so-keep-'))
    const full = Buffer.alloc(400, 4)
    const dest = join(root, 'fail.partial')

    let attempt = 0
    const httpFetch: HttpFetch = async (_url, init) => {
      attempt++
      const h = init?.headers as Record<string, string> | undefined
      if (attempt === 1) {
        let pulled = false
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!pulled) {
              pulled = true
              controller.enqueue(full.subarray(0, 150))
              return
            }
            return new Promise((_resolve, reject) => {
              setTimeout(() => reject(new Error('network reset')), 20)
            })
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-length': String(full.byteLength) },
        })
      }
      expect(h?.Range).toMatch(/^bytes=\d+-$/)
      const from = Number(h!.Range!.slice('bytes='.length, -1))
      expect(from).toBeGreaterThan(0)
      const tail = full.subarray(from)
      return new Response(tail, {
        status: 206,
        headers: {
          'content-length': String(tail.byteLength),
          'content-range': `bytes ${from}-${full.byteLength - 1}/${full.byteLength}`,
        },
      })
    }

    await expect(
      downloadResumableToFile(httpFetch, 'https://example.test/d.tgz', dest),
    ).rejects.toThrow(/network reset/)
    expect(existsSync(dest)).toBe(true)
    const partialSize = statSync(dest).size
    expect(partialSize).toBeGreaterThan(0)
    expect(partialSize).toBeLessThan(full.byteLength)

    const digests = await downloadResumableToFile(httpFetch, 'https://example.test/d.tgz', dest)
    expect(readFileSync(dest).equals(full)).toBe(true)
    expect(digests.sha256Hex).toBe(
      createHash('sha256').update(full).digest('hex'),
    )
  })
})
