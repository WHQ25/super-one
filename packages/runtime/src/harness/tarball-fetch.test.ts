import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSha256,
  fetchTarballWithFallback,
  resolveNpmPackMeta,
  sha256Hex,
  verifyNpmIntegrity,
  type DownloadToFile,
  type DownloadToFileResult,
} from './tarball-fetch'

function digestsOf(bytes: Uint8Array): DownloadToFileResult {
  return {
    byteLength: bytes.byteLength,
    sha256Hex: createHash('sha256').update(bytes).digest('hex'),
    sha512Base64: createHash('sha512').update(bytes).digest('base64'),
  }
}

describe('resolveNpmPackMeta', () => {
  it('parses registry JSON', async () => {
    const meta = await resolveNpmPackMeta('foo', '1.0.0', async () => ({
      version: '1.0.0',
      dist: {
        tarball: 'https://registry.npmjs.org/foo/-/foo-1.0.0.tgz',
        integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      },
    }))
    expect(meta.tarball).toContain('foo-1.0.0.tgz')
    expect(meta.integrity.startsWith('sha512-')).toBe(true)
  })

  it('encodes scoped package paths', async () => {
    let seen = ''
    await resolveNpmPackMeta('@scope/pkg', '2.0.0', async (url) => {
      seen = url
      return {
        version: '2.0.0',
        dist: {
          tarball: 'https://example/t.tgz',
          integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        },
      }
    })
    expect(seen).toContain('/@scope%2fpkg/2.0.0')
  })
})

describe('fetchTarballWithFallback', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('prefers R2 when pin.url is set and digest matches', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tf-r2-'))
    const dest = join(dir, 'a.tgz')
    const body = new TextEncoder().encode('r2-bytes')
    const d = digestsOf(body)
    const urls: string[] = []

    const downloadToFile: DownloadToFile = async (url, path) => {
      urls.push(url)
      writeFileSync(path, body)
      return d
    }

    const result = await fetchTarballWithFallback({
      destPath: dest,
      npmName: '@openai/codex',
      npmVersion: '1.0.0',
      pin: {
        platform: 'darwin',
        arch: 'arm64',
        digestSha256: d.sha256Hex,
        url: 'https://dl.super-one.dev/harness/artifacts/x/1.0.0.tgz',
      },
      fetchJson: async () => {
        throw new Error('npm should not be called')
      },
      downloadToFile,
    })

    expect(result.from).toBe('r2-tarball')
    expect(urls).toEqual(['https://dl.super-one.dev/harness/artifacts/x/1.0.0.tgz'])
    expect(readFileSync(dest).toString()).toBe('r2-bytes')
  })

  it('falls back to npm when R2 fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tf-npm-'))
    const dest = join(dir, 'b.tgz')
    const body = new TextEncoder().encode('npm-bytes')
    const d = digestsOf(body)
    const urls: string[] = []

    const result = await fetchTarballWithFallback({
      destPath: dest,
      npmName: 'pkg',
      npmVersion: '1.2.3',
      pin: {
        platform: 'darwin',
        arch: 'arm64',
        digestSha256: d.sha256Hex,
        url: 'https://dl.super-one.dev/fail.tgz',
      },
      fetchJson: async () => ({
        version: '1.2.3',
        dist: {
          tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz',
          integrity: `sha512-${d.sha512Base64}`,
        },
      }),
      downloadToFile: async (url, path) => {
        urls.push(url)
        if (url.includes('fail.tgz')) throw new Error('network')
        writeFileSync(path, body)
        return d
      },
    })

    expect(result.from).toBe('npm-tarball')
    expect(urls[0]).toContain('fail.tgz')
    expect(urls[1]).toContain('registry.npmjs.org')
  })

  it('npmOnly skips R2', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tf-only-'))
    const dest = join(dir, 'c.tgz')
    const body = new TextEncoder().encode('only-npm')
    const d = digestsOf(body)
    const urls: string[] = []

    await fetchTarballWithFallback({
      destPath: dest,
      npmName: 'pkg',
      npmVersion: '0.1.0',
      npmOnly: true,
      pin: {
        platform: 'darwin',
        arch: 'arm64',
        digestSha256: d.sha256Hex,
        url: 'https://dl.super-one.dev/should-skip.tgz',
      },
      fetchJson: async () => ({
        version: '0.1.0',
        dist: {
          tarball: 'https://registry.npmjs.org/pkg/-/pkg-0.1.0.tgz',
          integrity: `sha512-${d.sha512Base64}`,
        },
      }),
      downloadToFile: async (url, path) => {
        urls.push(url)
        writeFileSync(path, body)
        return d
      },
    })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('registry.npmjs.org')
  })

  it('rejects digest mismatch on R2 and still tries npm', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tf-mis-'))
    const dest = join(dir, 'd.tgz')
    const good = new TextEncoder().encode('good')
    const bad = new TextEncoder().encode('bad!')
    const goodD = digestsOf(good)
    const badD = digestsOf(bad)

    const result = await fetchTarballWithFallback({
      destPath: dest,
      npmName: 'pkg',
      npmVersion: '1.0.0',
      pin: {
        platform: 'darwin',
        arch: 'arm64',
        digestSha256: goodD.sha256Hex,
        url: 'https://dl.super-one.dev/bad.tgz',
      },
      fetchJson: async () => ({
        version: '1.0.0',
        dist: {
          tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
          integrity: `sha512-${goodD.sha512Base64}`,
        },
      }),
      downloadToFile: async (url, path) => {
        if (url.includes('bad.tgz')) {
          writeFileSync(path, bad)
          return badD
        }
        writeFileSync(path, good)
        return goodD
      },
    })

    expect(result.from).toBe('npm-tarball')
    expect(result.digests.sha256Hex).toBe(goodD.sha256Hex)
  })
})

describe('integrity helpers', () => {
  it('verifyNpmIntegrity / assertSha256', () => {
    const bytes = new TextEncoder().encode('x')
    const hex = sha256Hex(bytes)
    assertSha256(hex, hex)
    expect(() => assertSha256(hex, '0'.repeat(64))).toThrow(/sha256 mismatch/)
    const integ = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    verifyNpmIntegrity(bytes, integ)
  })
})
