import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ANTIGRAVITY_RELEASE_VERSION,
  resolveAntigravityReleaseAsset,
} from './antigravity-release'
import {
  extractVerifiedAntigravityZip,
  installAntigravityManagedRuntime,
  resolveAntigravityRuntime,
} from './antigravity-runtime'
import type { HarnessCatalogReader } from './types'

function buildTestZip(
  entries: Array<{ name: string; content: Buffer; compress?: boolean }>,
): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = entry.compress ? deflateRawSync(entry.content) : entry.content
    const method = entry.compress ? 8 : 0

    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt32LE(0, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(entry.content.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    nameBuf.copy(localHeader, 30)

    const centralHeader = Buffer.alloc(46 + nameBuf.length)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt32LE(0, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(entry.content.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt32LE((0o100755 << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    nameBuf.copy(centralHeader, 46)

    localParts.push(localHeader, compressed)
    centralParts.push(centralHeader)
    offset += localHeader.length + compressed.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

describe('resolveAntigravityReleaseAsset', () => {
  it('returns pinned release assets for supported platforms', () => {
    const mac = resolveAntigravityReleaseAsset('darwin', 'arm64')
    expect(mac?.version).toBe(ANTIGRAVITY_RELEASE_VERSION)
    expect(mac?.executable.name).toBe('agy_acp_server.par')
    expect(mac?.harness.name).toBe('localharness_external')

    const win = resolveAntigravityReleaseAsset('win32', 'x64')
    expect(win?.executable.name).toBe('agy_acp_server.exe')
    expect(win?.harness.name).toBe('localharness_external.exe')

    expect(resolveAntigravityReleaseAsset('freebsd', 'x64')).toBeNull()
  })
})

describe('Antigravity zip extraction and managed install', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'so-agy-rt-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('extracts verified executable and harness from zip archive', async () => {
    const execBuf = Buffer.from('#!/bin/sh\necho agy\n', 'utf8')
    const harnessBuf = Buffer.from('#!/bin/sh\necho harness\n', 'utf8')
    const zipBuf = buildTestZip([
      { name: 'agy_acp_server.par', content: execBuf, compress: true },
      { name: 'localharness_external', content: harnessBuf, compress: false },
    ])
    const zipPath = join(root, 'test.zip')
    const destDir = join(root, 'out')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(zipPath, zipBuf)

    await extractVerifiedAntigravityZip(
      zipPath,
      destDir,
      {
        executable: { name: 'agy_acp_server.par', bytes: execBuf.length },
        harness: { name: 'localharness_external', bytes: harnessBuf.length },
      },
      'darwin',
    )

    expect(readFileSync(join(destDir, 'agy_acp_server.par'), 'utf8')).toBe(execBuf.toString('utf8'))
    expect(readFileSync(join(destDir, 'localharness_external'), 'utf8')).toBe(
      harnessBuf.toString('utf8'),
    )
  })

  it('rejects zip archives with unexpected members or wrong sizes', async () => {
    const execBuf = Buffer.from('exec', 'utf8')
    const zipBuf = buildTestZip([{ name: 'agy_acp_server.par', content: execBuf, compress: true }])
    const zipPath = join(root, 'bad.zip')
    const destDir = join(root, 'bad-out')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(zipPath, zipBuf)

    await expect(
      extractVerifiedAntigravityZip(
        zipPath,
        destDir,
        {
          executable: { name: 'agy_acp_server.par', bytes: execBuf.length },
          harness: { name: 'localharness_external', bytes: 4 },
        },
        'darwin',
      ),
    ).rejects.toThrow(/contain exactly/)
  })

  it('installs managed runtime and resolves both managed and override binaries', async () => {
    const execBuf = Buffer.from('#!/bin/sh\necho server\n', 'utf8')
    const harnessBuf = Buffer.from('#!/bin/sh\necho sidecar\n', 'utf8')
    const zipBuf = buildTestZip([
      { name: 'agy_acp_server.par', content: execBuf, compress: true },
      { name: 'localharness_external', content: harnessBuf, compress: true },
    ])
    const sha256 = createHash('sha256').update(zipBuf).digest('hex')

    const installed = await installAntigravityManagedRuntime({
      homeRoot: root,
      platform: 'darwin',
      arch: 'arm64',
      asset: {
        version: '1.3.0',
        url: 'https://dl.google.com/agy-extensions/releases/1.3.0/darwin-arm64/agy_acp_server.zip',
        sha256,
        archiveBytes: zipBuf.length,
        executable: { name: 'agy_acp_server.par', bytes: execBuf.length },
        harness: { name: 'localharness_external', bytes: harnessBuf.length },
      },
      downloadToFile: async (_url, destPath) => {
        writeFileSync(destPath, zipBuf)
        return {
          byteLength: zipBuf.length,
          sha256Hex: sha256,
          sha512Base64: createHash('sha512').update(zipBuf).digest('base64'),
        }
      },
    })

    expect(existsSync(installed.command)).toBe(true)
    expect(installed.runtimeVersion).toBe('1.3.0')

    const catalog: HarnessCatalogReader = {
      get: () => ({
        id: 'acp-antigravity',
        runtimeSource: 'managed',
        enabled: true,
        state: 'ready',
        requiresAuth: false,
        command: installed.command,
        runtimeVersion: '1.3.0',
      }),
    }

    const resolvedManaged = resolveAntigravityRuntime(catalog, {
      homeRoot: root,
      platform: 'darwin',
    })
    expect(resolvedManaged?.source).toBe('managed')
    expect(resolvedManaged?.executablePath).toContain('agy_acp_server.par')
    expect(resolvedManaged?.harnessPath).toContain('localharness_external')

    const customDir = join(root, 'custom-bin')
    mkdirSync(customDir, { recursive: true })
    const customExec = join(customDir, 'agy_acp_server.par')
    const customHarness = join(customDir, 'localharness_external')
    writeFileSync(customExec, execBuf)
    writeFileSync(customHarness, harnessBuf)
    chmodSync(customExec, 0o755)
    chmodSync(customHarness, 0o755)

    const resolvedOverride = resolveAntigravityRuntime(catalog, {
      homeRoot: root,
      platform: 'darwin',
      override: { command: customExec },
    })
    expect(resolvedOverride?.source).toBe('override')
    expect(resolvedOverride?.executablePath).toContain('custom-bin')
  })
})
