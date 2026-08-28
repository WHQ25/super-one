import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codexPlatformVersion,
  createDesktopTarballInstaller,
  createThrottledProgress,
  desktopPackagePins,
  downloadResumableToFile,
  harnessArtifactDownloadKey,
  harnessPartialPath,
  installPackageDir,
  parseContentRange,
  readRuntimeVersion,
  resetDestPathLocksForTests,
  resolveDesktopManagedBinary,
  resolveHarnessManifestChannel,
  sha256Hex,
  streamResponseToFile,
  verifyNpmIntegrity,
  verifySha256,
  type HttpFetch,
} from './tarball-installer'
import {
  managedVersionDir,
  readCurrentPointer,
  writeCurrentPointer,
} from './managed-layout'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** Build a minimal npm-style tarball (package/ + files) with system tar. */
function makeNpmTgz(work: string, files: Record<string, string | { mode?: number; body: string }>): {
  tgzPath: string
  bytes: Uint8Array
} {
  const pkg = join(work, 'package')
  mkdirSync(pkg, { recursive: true })
  for (const [rel, val] of Object.entries(files)) {
    const abs = join(pkg, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    if (typeof val === 'string') {
      writeFileSync(abs, val)
    } else {
      writeFileSync(abs, val.body)
      if (val.mode) chmodSync(abs, val.mode)
    }
  }
  const tgzPath = join(work, 'payload.tgz')
  // Parent of package/ so the archive contains package/...
  const r = spawnSync('tar', ['-czf', tgzPath, '-C', work, 'package'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`tar pack failed: ${r.stderr}`)
  const bytes = new Uint8Array(readFileSync(tgzPath))
  return { tgzPath, bytes }
}

describe('verifyNpmIntegrity', () => {
  it('accepts matching sha512', () => {
    const bytes = new TextEncoder().encode('hello')
    verifyNpmIntegrity(bytes, sha512Integrity(bytes))
  })

  it('rejects mismatch', () => {
    const bytes = new TextEncoder().encode('hello')
    expect(() => verifyNpmIntegrity(bytes, 'sha512-AAAAAAAAAAAAAAAAAAAAAA==')).toThrow(
      /integrity mismatch/,
    )
  })
})

describe('desktopPackagePins', () => {
  it('pins claude to the platform package only', () => {
    const pins = desktopPackagePins('claude')
    expect(pins.packages).toHaveLength(1)
    expect(pins.packages[0]!.name).toMatch(/claude-agent-sdk-/)
    expect(pins.packages[0]!.nodeModulesDir).toBe(pins.packages[0]!.name)
  })

  it('pins codex to @openai/codex with a platform-suffixed version', () => {
    const pins = desktopPackagePins('codex')
    const desktopPackage = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(pins.packages[0]!.name).toBe('@openai/codex')
    expect(pins.runtimeVersion).toBe(desktopPackage.dependencies['@openai/codex'])
    expect(pins.packages[0]!.version).toBe(codexPlatformVersion())
    expect(pins.packages[0]!.version).toMatch(/-(darwin|linux|win32)-(arm64|x64)$/)
  })

  it('reads the installed Codex package version instead of stale install metadata', () => {
    const prefix = join(tmpdir(), `so-codex-version-${Date.now()}`)
    const versionDir = managedVersionDir(prefix, '0.149.0')
    try {
      mkdirSync(join(versionDir, 'lib/node_modules/@openai/codex'), { recursive: true })
      writeFileSync(
        join(versionDir, 'install-meta.json'),
        JSON.stringify({ harnessId: 'codex', runtimeVersion: '0.149.0' }),
      )
      writeFileSync(
        join(versionDir, 'lib/node_modules/@openai/codex/package.json'),
        JSON.stringify({ name: '@openai/codex', version: '0.147.0-darwin-arm64' }),
      )
      writeCurrentPointer(prefix, '0.149.0', { installRoot: versionDir })

      expect(readRuntimeVersion('codex', prefix)).toBe('0.147.0')
    } finally {
      rmSync(prefix, { recursive: true, force: true })
    }
  })
})

describe('createDesktopTarballInstaller', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'so-harness-home-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('downloads, verifies, extracts, and returns the claude binary path', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk-test', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho ok\n', mode: 0o755 },
      })
      const integrity = sha512Integrity(bytes)
      const pins = desktopPackagePins('claude')
      const pkgName = pins.packages[0]!.name

      const installer = createDesktopTarballInstaller({
        npmOnly: true,
        fetchJson: async () => ({
          version: pins.packages[0]!.version,
          dist: { tarball: 'https://example.test/pkg.tgz', integrity },
        }),
        fetchBinary: async () => bytes,
      })

      const progress: Array<[number, number]> = []
      const result = await installer.install('claude', { root: home }, (r, t) => progress.push([r, t]))

      expect(result.source).toBe('npm-tarball')
      expect(result.command).toContain(pkgName.replace(/^@/, '').split('/')[0] === 'anthropic-ai'
        ? 'claude-agent-sdk'
        : pkgName)
      expect(existsSync(result.command)).toBe(true)
      // Second install reuses without re-fetch (would throw if fetchJson called again)
      let fetchCount = 0
      const installer2 = createDesktopTarballInstaller({
        npmOnly: true,
        fetchJson: async () => {
          fetchCount++
          throw new Error('should not fetch on reuse')
        },
        fetchBinary: async () => {
          fetchCount++
          throw new Error('should not fetch on reuse')
        },
      })
      const reused = await installer2.install('claude', { root: home })
      expect(reused.detail?.reused).toBe('1')
      expect(fetchCount).toBe(0)
      const prefix = join(home, 'claude')
      expect(resolveDesktopManagedBinary('claude', prefix)).toBe(result.command)
      // Side-by-side layout: versions/<pin>/ + current (shared with CLI)
      const pin = desktopPackagePins('claude').runtimeVersion
      expect(readCurrentPointer(prefix)?.runtimeVersion).toBe(pin)
      expect(result.command).toContain(join('versions', pin))
      expect(existsSync(join(managedVersionDir(prefix, pin), 'install-meta.json'))).toBe(true)
      expect(existsSync(join(prefix, 'current'))).toBe(true)
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('installs a new pin side-by-side without deleting the previous version dir', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-sxs-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk-test', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho ok\n', mode: 0o755 },
      })
      const integrity = sha512Integrity(bytes)
      const pins = desktopPackagePins('claude')
      const prefix = join(home, 'claude')

      // Seed a "previous" version dir as if an older pin was installed.
      const oldVer = '0.0.0-old'
      const oldDir = managedVersionDir(prefix, oldVer)
      mkdirSync(join(oldDir, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-old'), {
        recursive: true,
      })
      writeFileSync(join(oldDir, 'install-meta.json'), JSON.stringify({ runtimeVersion: oldVer }))
      const oldBin = join(
        oldDir,
        'lib',
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk-old',
        'claude',
      )
      writeFileSync(oldBin, '#!/bin/sh\necho old\n')
      chmodSync(oldBin, 0o755)
      writeCurrentPointer(prefix, oldVer)

      const installer = createDesktopTarballInstaller({
        npmOnly: true,
        fetchJson: async () => ({
          version: pins.packages[0]!.version,
          dist: { tarball: 'https://example.test/pkg.tgz', integrity },
        }),
        fetchBinary: async () => bytes,
      })
      const result = await installer.install('claude', { root: home })

      expect(result.runtimeVersion).toBe(pins.runtimeVersion)
      expect(readCurrentPointer(prefix)?.runtimeVersion).toBe(pins.runtimeVersion)
      // Previous version dir still on disk until prune (kept as previous).
      expect(existsSync(oldDir)).toBe(true)
      expect(existsSync(managedVersionDir(prefix, pins.runtimeVersion))).toBe(true)
      expect(result.command).toContain(join('versions', pins.runtimeVersion))
      expect(resolveDesktopManagedBinary('claude', prefix)).toBe(result.command)
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('rejects a tarball whose integrity does not match', async () => {
    const installer = createDesktopTarballInstaller({
      npmOnly: true,
      fetchJson: async () => ({
        version: '0.0.1',
        dist: { tarball: 'https://example.test/x.tgz', integrity: 'sha512-AAAA' },
      }),
      fetchBinary: async () => new TextEncoder().encode('not-matching'),
    })
    await expect(installer.install('claude', { root: home })).rejects.toThrow(/integrity mismatch/)
  })

  it('prefers R2 when a channel pin provides a url, verifying sha256', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-r2-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: 'x', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho r2\n', mode: 0o755 },
      })
      const digest = sha256Hex(bytes)
      const urls: string[] = []
      const installer = createDesktopTarballInstaller({
        artifactPin: {
          platform: 'darwin',
          arch: 'arm64',
          digestSha256: digest,
          url: 'https://dl.super-one.dev/harness/artifacts/test/0.tgz',
          npmName: desktopPackagePins('claude').packages[0]!.name,
          npmVersion: desktopPackagePins('claude').packages[0]!.version,
        },
        fetchJson: async () => {
          throw new Error('npm should not be consulted when R2 succeeds')
        },
        fetchBinary: async (url) => {
          urls.push(url)
          return bytes
        },
      })
      const result = await installer.install('claude', { root: home })
      expect(result.source).toBe('r2-tarball')
      expect(urls).toEqual(['https://dl.super-one.dev/harness/artifacts/test/0.tgz'])
      expect(existsSync(result.command)).toBe(true)
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('ignores a stale R2 artifact pin and installs the requested npm version', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-stale-r2-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: 'x', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho npm\n', mode: 0o755 },
      })
      const integrity = sha512Integrity(bytes)
      const pins = desktopPackagePins('claude')
      const urls: string[] = []
      const installer = createDesktopTarballInstaller({
        artifactPin: {
          platform: 'darwin',
          arch: 'arm64',
          digestSha256: sha256Hex(bytes),
          url: 'https://dl.super-one.dev/harness/artifacts/stale.tgz',
          npmName: pins.packages[0]!.name,
          npmVersion: '0.0.0-stale',
        },
        fetchJson: async () => ({
          version: pins.packages[0]!.version,
          dist: { tarball: 'https://registry.npmjs.org/current.tgz', integrity },
        }),
        fetchBinary: async (url) => {
          urls.push(url)
          return bytes
        },
      })

      const result = await installer.install('claude', { root: home })

      expect(result.source).toBe('npm-tarball')
      expect(result.detail?.packageSpec).toBe(`${pins.packages[0]!.name}@${pins.packages[0]!.version}`)
      expect(urls).toEqual(['https://registry.npmjs.org/current.tgz'])
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('falls back to npm when R2 fails, still enforcing pin sha256', async () => {
    const packWork = mkdtempSync(join(tmpdir(), 'so-pack-fb-'))
    try {
      const { bytes } = makeNpmTgz(packWork, {
        'package.json': JSON.stringify({ name: 'x', version: '0.0.1' }),
        claude: { body: '#!/bin/sh\necho npm\n', mode: 0o755 },
      })
      const digest = sha256Hex(bytes)
      const integrity = sha512Integrity(bytes)
      const urls: string[] = []
      const installer = createDesktopTarballInstaller({
        artifactPin: {
          platform: 'darwin',
          arch: 'arm64',
          digestSha256: digest,
          url: 'https://dl.super-one.dev/harness/artifacts/test/0.tgz',
          npmName: desktopPackagePins('claude').packages[0]!.name,
          npmVersion: desktopPackagePins('claude').packages[0]!.version,
        },
        fetchJson: async () => ({
          version: desktopPackagePins('claude').packages[0]!.version,
          dist: { tarball: 'https://registry.npmjs.org/pkg.tgz', integrity },
        }),
        fetchBinary: async (url) => {
          urls.push(url)
          if (url.includes('dl.super-one.dev')) throw new Error('R2 down')
          return bytes
        },
      })
      const result = await installer.install('claude', { root: home })
      expect(result.source).toBe('npm-tarball')
      expect(urls[0]).toContain('dl.super-one.dev')
      expect(urls[1]).toContain('registry.npmjs.org')
    } finally {
      rmSync(packWork, { recursive: true, force: true })
    }
  })

  it('rejects npm bytes that do not match the pin sha256', async () => {
    const installer = createDesktopTarballInstaller({
      artifactPin: {
        platform: 'darwin',
        arch: 'arm64',
        digestSha256: 'a'.repeat(64),
        url: undefined,
        npmName: desktopPackagePins('claude').packages[0]!.name,
        npmVersion: desktopPackagePins('claude').packages[0]!.version,
      },
      fetchJson: async () => ({
        version: '0.0.1',
        dist: {
          tarball: 'https://registry.npmjs.org/pkg.tgz',
          integrity: sha512Integrity(new TextEncoder().encode('x')),
        },
      }),
      fetchBinary: async () => new TextEncoder().encode('x'),
    })
    await expect(installer.install('claude', { root: home })).rejects.toThrow(/sha256 mismatch/)
  })
})

describe('resolveHarnessManifestChannel', () => {
  it('prefers explicit, then env, then version', () => {
    expect(resolveHarnessManifestChannel('beta')).toBe('beta')
    const prev = process.env.SUPERONE_HARNESS_CHANNEL
    process.env.SUPERONE_HARNESS_CHANNEL = 'stable'
    try {
      expect(resolveHarnessManifestChannel()).toBe('stable')
    } finally {
      if (prev === undefined) delete process.env.SUPERONE_HARNESS_CHANNEL
      else process.env.SUPERONE_HARNESS_CHANNEL = prev
    }
    expect(resolveHarnessManifestChannel(undefined, '0.52.0-alpha')).toBe('alpha')
    expect(resolveHarnessManifestChannel(undefined, '1.0.0')).toBe('stable')
  })
})

describe('verifySha256', () => {
  it('accepts matching hex digest', () => {
    const bytes = new TextEncoder().encode('hi')
    verifySha256(bytes, sha256Hex(bytes))
  })
})

describe('createThrottledProgress', () => {
  it('emits first, throttled mid, and final when total reached', () => {
    const calls: Array<[number, number]> = []
    const emit = createThrottledProgress((r, t) => calls.push([r, t]), 1_000)!
    emit(10, 100)
    emit(20, 100) // within throttle window — dropped
    emit(100, 100) // done — always emitted
    expect(calls).toEqual([
      [10, 100],
      [100, 100],
    ])
  })
})

describe('streamResponseToFile', () => {
  it('streams body to disk and returns digests without buffering the caller', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-stream-'))
    try {
      const body = Buffer.alloc(64 * 1024, 7)
      const dest = join(root, 'out.bin')
      const res = new Response(body, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      })
      const progress: Array<[number, number]> = []
      const digests = await streamResponseToFile(res, dest, (r, t) => progress.push([r, t]))
      expect(digests.byteLength).toBe(body.byteLength)
      expect(digests.sha256Hex).toBe(sha256Hex(body))
      expect(digests.sha512Base64).toBe(createHash('sha512').update(body).digest('base64'))
      expect(readFileSync(dest).equals(body)).toBe(true)
      expect(progress.length).toBeGreaterThan(0)
      expect(progress[progress.length - 1]).toEqual([body.byteLength, body.byteLength])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('appends and seeds hash when resumeFrom > 0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-append-'))
    try {
      const full = Buffer.concat([Buffer.alloc(100, 1), Buffer.alloc(50, 2)])
      const dest = join(root, 'part.bin')
      writeFileSync(dest, full.subarray(0, 100))
      const tail = full.subarray(100)
      const res = new Response(tail, {
        status: 206,
        headers: {
          'content-length': String(tail.byteLength),
          'content-range': `bytes 100-149/${full.byteLength}`,
        },
      })
      const digests = await streamResponseToFile(res, dest, undefined, {
        resumeFrom: 100,
        append: true,
        totalBytes: full.byteLength,
      })
      expect(readFileSync(dest).equals(full)).toBe(true)
      expect(digests.byteLength).toBe(full.byteLength)
      expect(digests.sha256Hex).toBe(sha256Hex(full))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps partial on stream error when keepPartialOnError', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-keep-'))
    try {
      const dest = join(root, 'x.partial')
      writeFileSync(dest, Buffer.alloc(20, 9))
      // A body that errors mid-stream is hard with Response; simulate by
      // resumeFrom mismatch which throws before overwrite.
      await expect(
        streamResponseToFile(
          new Response(Buffer.alloc(5), { status: 206 }),
          dest,
          undefined,
          { resumeFrom: 99, append: true },
        ),
      ).rejects.toThrow(/partial size mismatch/)
      expect(existsSync(dest)).toBe(true)
      expect(statSync(dest).size).toBe(20)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('parseContentRange', () => {
  it('parses start/end/total', () => {
    expect(parseContentRange('bytes 100-199/1000')).toEqual({
      start: 100,
      end: 199,
      total: 1000,
    })
    expect(parseContentRange('bytes 0-99/*')).toEqual({ start: 0, end: 99, total: null })
    expect(parseContentRange(null)).toBeNull()
  })
})

describe('downloadResumableToFile', () => {
  it('sends Range and appends when a partial exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-resume-'))
    try {
      const full = Buffer.alloc(500, 3)
      const dest = join(root, 'art.partial')
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
      expect(digests.byteLength).toBe(500)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restarts when server returns 200 ignoring Range', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-restart-'))
    try {
      const full = Buffer.alloc(300, 5)
      const dest = join(root, 'art.partial')
      writeFileSync(dest, Buffer.alloc(100, 1)) // wrong prefix

      const httpFetch: HttpFetch = async (_url, init) => {
        const h = init?.headers as Record<string, string> | undefined
        // First call has Range; we ignore and return full 200.
        expect(h?.Range).toBe('bytes=100-')
        return new Response(full, {
          status: 200,
          headers: { 'content-length': String(full.byteLength) },
        })
      }

      const digests = await downloadResumableToFile(httpFetch, 'https://example.test/b.tgz', dest)
      expect(readFileSync(dest).equals(full)).toBe(true)
      expect(digests.sha256Hex).toBe(sha256Hex(full))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reuses a complete partial after 416 + HEAD size match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-416-'))
    try {
      const full = Buffer.alloc(256, 8)
      const dest = join(root, 'done.partial')
      writeFileSync(dest, full)

      let calls = 0
      const httpFetch: HttpFetch = async (_url, init) => {
        calls++
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { 'content-length': String(full.byteLength) },
          })
        }
        return new Response('nope', { status: 416 })
      }

      const digests = await downloadResumableToFile(httpFetch, 'https://example.test/c.tgz', dest)
      expect(calls).toBe(2) // GET Range → 416, then HEAD
      expect(digests.byteLength).toBe(256)
      expect(digests.sha256Hex).toBe(sha256Hex(full))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent downloads to the same destPath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-lock-'))
    try {
      resetDestPathLocksForTests()
      const full = Buffer.alloc(500, 9)
      const dest = join(root, 'shared.partial')
      let active = 0
      let maxActive = 0
      let calls = 0

      const httpFetch: HttpFetch = async () => {
        calls++
        active++
        maxActive = Math.max(maxActive, active)
        // Overlapping writers would race on append; hold the first response open briefly.
        await new Promise((r) => setTimeout(r, 40))
        active--
        return new Response(full, {
          status: 200,
          headers: { 'content-length': String(full.byteLength) },
        })
      }

      const [a, b] = await Promise.all([
        downloadResumableToFile(httpFetch, 'https://example.test/lock.tgz', dest),
        downloadResumableToFile(httpFetch, 'https://example.test/lock.tgz', dest),
      ])

      expect(maxActive).toBe(1)
      expect(calls).toBe(2)
      expect(a.sha256Hex).toBe(sha256Hex(full))
      expect(b.sha256Hex).toBe(sha256Hex(full))
      expect(readFileSync(dest).equals(full)).toBe(true)
    } finally {
      resetDestPathLocksForTests()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps partial after a mid-download failure for a later resume', async () => {
    const root = mkdtempSync(join(tmpdir(), 'so-fail-keep-'))
    try {
      const full = Buffer.alloc(400, 4)
      const dest = join(root, 'fail.partial')

      let attempt = 0
      const httpFetch: HttpFetch = async (_url, init) => {
        attempt++
        const h = init?.headers as Record<string, string> | undefined
        if (attempt === 1) {
          // Deliver a chunk, then fail after the write has a chance to flush.
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
        // Second attempt: resume from whatever was written
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
      expect(digests.sha256Hex).toBe(sha256Hex(full))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('harnessArtifactDownloadKey / harnessPartialPath', () => {
  it('prefers digest prefix and builds a safe path', () => {
    const key = harnessArtifactDownloadKey({
      harnessId: 'claude',
      digestSha256: 'e5bbd2a1f107683125ceb1381e1c5d378969a9287061e910b04c55f68d73b9c1',
      npmName: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      npmVersion: '0.3.226',
    })
    expect(key).toBe('claude-e5bbd2a1f107683125ceb138')
    const p = harnessPartialPath('/tmp/home', key)
    expect(p).toBe('/tmp/home/.download/claude-e5bbd2a1f107683125ceb138.partial')
  })
})

describe('installPackageDir', () => {
  it('places package under scoped node_modules path', () => {
    const root = mkdtempSync(join(tmpdir(), 'so-pkg-'))
    try {
      const pkg = join(root, 'package')
      mkdirSync(pkg)
      writeFileSync(join(pkg, 'bin'), 'x')
      const prefix = join(root, 'prefix')
      const dest = installPackageDir(pkg, prefix, '@anthropic-ai/claude-agent-sdk-darwin-arm64')
      expect(dest).toBe(
        join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64'),
      )
      expect(existsSync(join(dest, 'bin'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
