import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'fs/promises'
import { createWriteStream, existsSync } from 'fs'
import { tmpdir } from 'os'
import archiver from 'archiver'

const { saveMcpConfigMock, deleteMcpConfigMock, saveCodexMcpConfigMock, deleteCodexMcpConfigMock, addBundleLibraryEntryMock, deleteLibraryEntryMock, safeStorageState } = vi.hoisted(() => ({
  saveMcpConfigMock: vi.fn(),
  deleteMcpConfigMock: vi.fn(),
  saveCodexMcpConfigMock: vi.fn(),
  deleteCodexMcpConfigMock: vi.fn(),
  addBundleLibraryEntryMock: vi.fn(),
  deleteLibraryEntryMock: vi.fn(),
  safeStorageState: { encryptionAvailable: true },
}))

vi.mock('../mcp-config-service', () => ({
  saveMcpConfig: saveMcpConfigMock,
  deleteMcpConfig: deleteMcpConfigMock,
}))

vi.mock('../codex-config-service', () => ({
  saveCodexMcpConfig: saveCodexMcpConfigMock,
  deleteCodexMcpConfig: deleteCodexMcpConfigMock,
}))

vi.mock('../mcp-library-service', () => ({
  addBundleLibraryEntry: addBundleLibraryEntryMock,
  deleteLibraryEntry: deleteLibraryEntryMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return tmpdir()
      if (name === 'temp') return tmpdir()
      return tmpdir()
    },
  },
  shell: { showItemInFolder: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
  },
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { previewMcpbBundle, installMcpbBundle, uninstallMcpbBundle, listInstalledMcpb, type McpbInstallMeta } from './mcpb-installer'
import type { McpbManifest } from '@superone/shared/mcpb-types'

interface BundleSpec {
  manifest: McpbManifest
  files?: Record<string, string | Buffer>
  manifestRaw?: string
}

async function buildBundle(outDir: string, spec: BundleSpec, name: string = `${spec.manifest.name}.mcpb`): Promise<string> {
  const outPath = join(outDir, name)
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.append(spec.manifestRaw ?? JSON.stringify(spec.manifest, null, 2), { name: 'manifest.json' })
    for (const [path, content] of Object.entries(spec.files ?? {})) {
      archive.append(content, { name: path })
    }
    archive.finalize()
  })
  return outPath
}

function nodeManifest(overrides: Partial<McpbManifest> = {}): McpbManifest {
  return {
    manifest_version: '0.3',
    name: 'demo-server',
    version: '1.0.0',
    description: 'A test bundle',
    author: { name: 'Tester' },
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {},
      },
    },
    user_config: {},
    tools: [{ name: 'echo', description: 'Echo a message' }],
    tools_generated: false,
    prompts: [],
    prompts_generated: false,
    ...overrides,
  }
}

describe('mcpb installer', () => {
  let workDir: string
  let bundleDir: string
  let installRoot: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'mcpb-test-'))
    bundleDir = join(workDir, 'bundles')
    installRoot = join(workDir, 'mcpb-installs')
    await mkdir(bundleDir, { recursive: true })
    await mkdir(installRoot, { recursive: true })
    saveMcpConfigMock.mockReset()
    deleteMcpConfigMock.mockReset()
    saveCodexMcpConfigMock.mockReset()
    deleteCodexMcpConfigMock.mockReset()
    addBundleLibraryEntryMock.mockReset()
    deleteLibraryEntryMock.mockReset()
    safeStorageState.encryptionAvailable = true
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  describe('previewMcpbBundle', () => {
    it('returns manifest, hash and runtime availability without writing to install dir', async () => {
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest(),
        files: { 'server/index.js': '// hi' },
      })

      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })

      expect(preview.manifest.name).toBe('demo-server')
      expect(preview.manifestHash).toMatch(/^[a-f0-9]{64}$/)
      expect(preview.runtime.ok).toBe(true)
      expect(preview.platformSupported).toBe(true)
      expect(preview.conflictsWith).toBeUndefined()
      expect(existsSync(installRoot)).toBe(true)
      expect((await readDirSafe(installRoot)).length).toBe(0)
    })

    it('rejects an invalid manifest with descriptive errors', async () => {
      const bad = await buildBundle(bundleDir, {
        manifest: nodeManifest(),
        manifestRaw: JSON.stringify({ invalid: true }),
      })
      await expect(previewMcpbBundle(bad, { rootDir: installRoot, tempBaseDir: workDir }))
        .rejects.toThrow(/Invalid manifest/)
    })

    it('accepts a manifest whose name uses uppercase letters (e.g. "Blender")', async () => {
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest({ name: 'Blender' }),
      }, 'blender.mcpb')
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      expect(preview.manifest.name).toBe('Blender')
    })

    it.each([
      ['parent-dir traversal', '../evil'],
      ['deep traversal', '../../etc/passwd'],
      ['embedded subdir', 'foo/bar'],
      ['just dot-dot', '..'],
    ])('rejects a manifest whose name escapes install root (%s)', async (_label, badName) => {
      const bad = await buildBundle(bundleDir, {
        manifest: nodeManifest({ name: badName }),
      }, 'evil.mcpb')
      await expect(previewMcpbBundle(bad, { rootDir: installRoot, tempBaseDir: workDir }))
        .rejects.toThrow(/escape install root/)
    })

    it('reports platform support when manifest declares incompatible platforms', async () => {
      const otherPlatform: 'darwin' | 'win32' | 'linux' = process.platform === 'win32' ? 'darwin' : 'win32'
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest({
          compatibility: { platforms: [otherPlatform] },
        }),
      })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      expect(preview.platformSupported).toBe(false)
      expect(preview.warnings.some((w) => w.includes('does not support'))).toBe(true)
    })

    it('detects existing install as conflict', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const previewFirst = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: previewFirst.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      const file2 = await buildBundle(bundleDir, {
        manifest: nodeManifest({ version: '2.0.0' }),
      }, 'demo-server-2.mcpb')
      const preview2 = await previewMcpbBundle(file2, { rootDir: installRoot, tempBaseDir: workDir })
      expect(preview2.conflictsWith).toEqual({
        name: 'demo-server',
        existingVersion: '1.0.0',
        sameVersion: false,
      })
    })
  })

  describe('installMcpbBundle', () => {
    it('copies bundle into ~/.superone/mcpb/<name>@<version>/ and writes install.json', async () => {
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest(),
        files: { 'server/index.js': '// hi' },
      })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })

      const result = await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(result.installDir).toBe(join(installRoot, 'demo-server@1.0.0'))
      expect(existsSync(join(result.installDir, 'manifest.json'))).toBe(true)
      expect(existsSync(join(result.installDir, 'server/index.js'))).toBe(true)
      const meta = JSON.parse(await readFile(join(result.installDir, 'install.json'), 'utf-8')) as McpbInstallMeta
      expect(meta.name).toBe('demo-server')
      expect(meta.version).toBe('1.0.0')
      expect(meta.scope).toBe('user')
      expect(meta.manifestHash).toBe(preview.manifestHash)
    })

    it('rejects install when manifestHash does not match (bundle changed since preview)', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      await expect(installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: 'deadbeef',
      }, { rootDir: installRoot, tempBaseDir: workDir })).rejects.toThrow(/manifest changed/i)
    })

    it('writes a library entry tagged with bundleId so the bundle appears in shared MCP library', async () => {
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest({ description: 'Bundle description for library' }),
      })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })

      await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(addBundleLibraryEntryMock).toHaveBeenCalledTimes(1)
      const arg = addBundleLibraryEntryMock.mock.calls[0][0]
      expect(arg.name).toBe('demo-server')
      expect(arg.bundleVersion).toBe('1.0.0')
      expect(arg.command).toBeTruthy()
      expect(arg.description).toBe('Bundle description for library')
    })

    it('rejects install when scope is "project" but cwd is missing or empty', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })

      const baseReq = {
        filePath: file,
        provider: 'claude' as const,
        scope: 'project' as const,
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }
      await expect(installMcpbBundle(baseReq, { rootDir: installRoot, tempBaseDir: workDir }))
        .rejects.toThrow(/Project scope requires/)
      await expect(installMcpbBundle({ ...baseReq, cwd: '' }, { rootDir: installRoot, tempBaseDir: workDir }))
        .rejects.toThrow(/Project scope requires/)
      expect(saveMcpConfigMock).not.toHaveBeenCalled()
      expect((await readDirSafe(installRoot)).length).toBe(0)
    })

    it('writes encrypted secrets file and keeps sensitive keys out of install.json', async () => {
      const manifest = nodeManifest({
        user_config: {
          API_KEY: { type: 'string', title: 'API key', required: true, sensitive: true, multiple: false },
          REGION: { type: 'string', title: 'Region', required: false, sensitive: false, multiple: false },
        },
      })
      const file = await buildBundle(bundleDir, { manifest })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      const result = await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: { API_KEY: 'sk-secret', REGION: 'us-east-1' },
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      const meta = JSON.parse(await readFile(join(result.installDir, 'install.json'), 'utf-8')) as McpbInstallMeta
      expect(meta.userConfigSensitiveKeys).toEqual(['API_KEY'])
      expect(meta.userConfigPlain).toEqual({ REGION: 'us-east-1' })
      expect(JSON.stringify(meta)).not.toContain('sk-secret')

      expect(existsSync(join(result.installDir, 'secrets.bin'))).toBe(true)
      const secretsBuf = await readFile(join(result.installDir, 'secrets.bin'))
      expect(secretsBuf.toString('utf-8')).toContain('sk-secret')
    })

    it('passes resolved stdio config to saveMcpConfig with electron exec + ELECTRON_RUN_AS_NODE', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(saveMcpConfigMock).toHaveBeenCalledTimes(1)
      const [name, config, scope, cwd] = saveMcpConfigMock.mock.calls[0]
      expect(name).toBe('demo-server')
      expect(scope).toBe('user')
      expect(cwd).toBe('')
      expect(config.type).toBe('stdio')
      expect(config.command).toBe(process.execPath)
      expect(config.env.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(config.args[0]).toBe(join(installRoot, 'demo-server@1.0.0', 'server/index.js'))
    })

    it('routes to saveCodexMcpConfig and stores provider in install meta when provider is codex', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      const result = await installMcpbBundle({
        filePath: file,
        provider: 'codex',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(saveCodexMcpConfigMock).toHaveBeenCalledTimes(1)
      expect(saveMcpConfigMock).not.toHaveBeenCalled()
      const meta = JSON.parse(await readFile(join(result.installDir, 'install.json'), 'utf-8')) as McpbInstallMeta
      expect(meta.provider).toBe('codex')
    })

    it('replaces an older version on upgrade install', async () => {
      const v1 = await buildBundle(bundleDir, { manifest: nodeManifest({ version: '1.0.0' }) }, 'v1.mcpb')
      const preview1 = await previewMcpbBundle(v1, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: v1,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview1.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })
      expect(existsSync(join(installRoot, 'demo-server@1.0.0'))).toBe(true)

      const v2 = await buildBundle(bundleDir, { manifest: nodeManifest({ version: '2.0.0' }) }, 'v2.mcpb')
      const preview2 = await previewMcpbBundle(v2, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: v2,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview2.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(existsSync(join(installRoot, 'demo-server@1.0.0'))).toBe(false)
      expect(existsSync(join(installRoot, 'demo-server@2.0.0'))).toBe(true)
    })
  })

  describe('uninstallMcpbBundle', () => {
    it('keeps install dir intact and calls deleteMcpConfig with stored scope/cwd', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      const result = await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'project',
        cwd: '/Users/me/project',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })
      expect(existsSync(result.installDir)).toBe(true)

      await uninstallMcpbBundle('demo-server', { rootDir: installRoot, tempBaseDir: workDir })

      expect(existsSync(result.installDir)).toBe(true)
      expect(deleteMcpConfigMock).toHaveBeenCalledWith('demo-server', 'project', '/Users/me/project')
    })

    it('preserves encrypted secrets.bin so re-install does not require re-entering sensitive user_config', async () => {
      const manifest = nodeManifest({
        user_config: {
          API_KEY: { type: 'string', title: 'API key', required: true, sensitive: true, multiple: false },
        },
      })
      const file = await buildBundle(bundleDir, { manifest })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      const result = await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: { API_KEY: 'sk-secret' },
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      expect(existsSync(join(result.installDir, 'secrets.bin'))).toBe(true)

      await uninstallMcpbBundle('demo-server', { rootDir: installRoot, tempBaseDir: workDir })

      expect(existsSync(join(result.installDir, 'secrets.bin'))).toBe(true)
    })

    it('is a no-op when bundle is not installed', async () => {
      await uninstallMcpbBundle('not-there', { rootDir: installRoot, tempBaseDir: workDir })
      expect(deleteMcpConfigMock).not.toHaveBeenCalled()
    })

    it('leaves the library entry intact so the user can re-install later', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: file,
        provider: 'claude',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      await uninstallMcpbBundle('demo-server', { rootDir: installRoot, tempBaseDir: workDir })

      expect(deleteLibraryEntryMock).not.toHaveBeenCalled()
    })

    it('routes deletion to deleteCodexMcpConfig when meta.provider is codex, plus best-effort claude user-scope cleanup', async () => {
      const file = await buildBundle(bundleDir, { manifest: nodeManifest() })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({
        filePath: file,
        provider: 'codex',
        scope: 'user',
        userConfig: {},
        expectedManifestHash: preview.manifestHash,
      }, { rootDir: installRoot, tempBaseDir: workDir })

      await uninstallMcpbBundle('demo-server', { rootDir: installRoot, tempBaseDir: workDir })

      expect(deleteCodexMcpConfigMock).toHaveBeenCalledWith('demo-server', 'user', '')
      expect(deleteMcpConfigMock).toHaveBeenCalledWith('demo-server', 'user', '')
    })
  })

  describe('listInstalledMcpb', () => {
    it('returns installed bundles sorted by name', async () => {
      const a = await buildBundle(bundleDir, { manifest: nodeManifest({ name: 'aaa' }) }, 'a.mcpb')
      const b = await buildBundle(bundleDir, { manifest: nodeManifest({ name: 'bbb' }) }, 'b.mcpb')
      const previewA = await previewMcpbBundle(a, { rootDir: installRoot, tempBaseDir: workDir })
      const previewB = await previewMcpbBundle(b, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({ filePath: a, provider: 'claude', scope: 'user', userConfig: {}, expectedManifestHash: previewA.manifestHash }, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({ filePath: b, provider: 'claude', scope: 'user', userConfig: {}, expectedManifestHash: previewB.manifestHash }, { rootDir: installRoot, tempBaseDir: workDir })

      const list = await listInstalledMcpb({ rootDir: installRoot, tempBaseDir: workDir })
      expect(list.map((e) => e.meta.name)).toEqual(['aaa', 'bbb'])
    })

    it('returns empty list when root dir does not exist', async () => {
      const list = await listInstalledMcpb({ rootDir: join(workDir, 'never-created'), tempBaseDir: workDir })
      expect(list).toEqual([])
    })

    it('surfaces iconDataUrl from the bundle manifest for installed entries', async () => {
      const pngBytes = Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex')
      const file = await buildBundle(bundleDir, {
        manifest: nodeManifest({ icon: 'icon.png' }),
        files: { 'icon.png': pngBytes },
      })
      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      await installMcpbBundle({ filePath: file, provider: 'claude', scope: 'user', userConfig: {}, expectedManifestHash: preview.manifestHash }, { rootDir: installRoot, tempBaseDir: workDir })

      const list = await listInstalledMcpb({ rootDir: installRoot, tempBaseDir: workDir })
      expect(list).toHaveLength(1)
      expect(list[0].iconDataUrl).toMatch(/^data:image\/png;base64,/)
    })
  })

  describe('large bundle round-trip', () => {
    it('previewMcpbBundle recovers manifest from a .mcpb containing many entries', async () => {
      const files: Record<string, string> = {}
      for (let i = 0; i < 12; i++) {
        files[`assets/f${i}.txt`] = `payload-${i}`
      }
      files['server/index.js'] = 'console.log("hi")'
      const file = await buildBundle(bundleDir, { manifest: nodeManifest(), files })

      const preview = await previewMcpbBundle(file, { rootDir: installRoot, tempBaseDir: workDir })
      expect(preview.manifest.name).toBe('demo-server')
      expect(preview.manifest.version).toBe('1.0.0')
    })
  })

  describe('extract error paths', () => {
    it('rejects when zip file does not exist', async () => {
      await expect(
        previewMcpbBundle(join(bundleDir, 'nope.mcpb'), { rootDir: installRoot, tempBaseDir: workDir }),
      ).rejects.toThrow()
    })

    it('rejects when zip file is corrupt', async () => {
      const corrupt = join(bundleDir, 'corrupt.mcpb')
      await writeFile(corrupt, Buffer.from('not a real zip file, just garbage bytes'))
      await expect(
        previewMcpbBundle(corrupt, { rootDir: installRoot, tempBaseDir: workDir }),
      ).rejects.toThrow()
    })
  })
})

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises')
    return await readdir(dir)
  } catch {
    return []
  }
}
