import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { mkdtemp, writeFile, mkdir, rm, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { generateIntegrity, verifyIntegrity, confirmInstall } from './miniapp-packager'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return tmpdir()
      if (name === 'temp') return tmpdir()
      return tmpdir()
    },
  },
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('integrity', () => {
  let appDir: string

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 's1-test-'))
    await writeFile(join(appDir, 'manifest.json'), JSON.stringify({ appId: 'test', name: 'Test', version: '1.0.0' }))
    await writeFile(join(appDir, 'index.html'), '<html>hello</html>')
  })

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true })
  })

  describe('generateIntegrity', () => {
    it('should generate hashes for all files', async () => {
      const integrity = await generateIntegrity(appDir)
      expect(integrity.files).toHaveProperty('manifest.json')
      expect(integrity.files).toHaveProperty('index.html')
      expect(Object.keys(integrity.files)).toHaveLength(2)
    })

    it('should exclude integrity.json, install.json, and preapproved.json', async () => {
      await writeFile(join(appDir, 'integrity.json'), '{}')
      await writeFile(join(appDir, 'install.json'), '{}')
      await writeFile(join(appDir, 'preapproved.json'), '{"tools":["render"]}')
      const integrity = await generateIntegrity(appDir)
      expect(integrity.files).not.toHaveProperty('integrity.json')
      expect(integrity.files).not.toHaveProperty('install.json')
      expect(integrity.files).not.toHaveProperty('preapproved.json')
    })

    it('should handle nested directories', async () => {
      await mkdir(join(appDir, 'assets'), { recursive: true })
      await writeFile(join(appDir, 'assets', 'style.css'), 'body {}')
      const integrity = await generateIntegrity(appDir)
      expect(integrity.files).toHaveProperty('assets/style.css')
    })

    it('should produce consistent SHA-256 hashes', async () => {
      const i1 = await generateIntegrity(appDir)
      const i2 = await generateIntegrity(appDir)
      expect(i1.files).toEqual(i2.files)
    })
  })

  describe('verifyIntegrity', () => {
    it('should pass when all files match', async () => {
      const integrity = await generateIntegrity(appDir)
      await writeFile(join(appDir, 'integrity.json'), JSON.stringify(integrity))
      const result = await verifyIntegrity(appDir)
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail when a file is modified', async () => {
      const integrity = await generateIntegrity(appDir)
      await writeFile(join(appDir, 'integrity.json'), JSON.stringify(integrity))
      await writeFile(join(appDir, 'index.html'), '<html>tampered</html>')
      const result = await verifyIntegrity(appDir)
      expect(result.ok).toBe(false)
      expect(result.errors).toContain('hash mismatch: index.html')
    })

    it('should fail when a file is missing', async () => {
      const integrity = await generateIntegrity(appDir)
      integrity.files['missing.js'] = 'deadbeef'
      await writeFile(join(appDir, 'integrity.json'), JSON.stringify(integrity))
      const result = await verifyIntegrity(appDir)
      expect(result.ok).toBe(false)
      expect(result.errors).toContain('missing file: missing.js')
    })

    it('should fail when unexpected file is present', async () => {
      const integrity = await generateIntegrity(appDir)
      await writeFile(join(appDir, 'integrity.json'), JSON.stringify(integrity))
      await writeFile(join(appDir, 'extra.js'), 'malicious()')
      const result = await verifyIntegrity(appDir)
      expect(result.ok).toBe(false)
      expect(result.errors).toContain('unexpected file: extra.js')
    })

    it('should fail when integrity.json is missing', async () => {
      const result = await verifyIntegrity(appDir)
      expect(result.ok).toBe(false)
      expect(result.errors).toContain('integrity.json not found or invalid')
    })
  })
})

describe('confirmInstall preservation', () => {
  let tempDir: string
  let installRoot: string
  const appId = 'preserved-app'

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 's1-install-temp-'))
    installRoot = await mkdtemp(join(tmpdir(), 's1-install-root-'))
    await writeFile(
      join(tempDir, 'manifest.json'),
      JSON.stringify({ appId, name: 'Preserved', version: '2.0.0' }),
    )
    await writeFile(join(tempDir, 'index.html'), '<html>v2</html>')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    await rm(installRoot, { recursive: true, force: true }).catch(() => {})
  })

  async function dirExists(p: string): Promise<boolean> {
    try {
      return (await stat(p)).isDirectory()
    } catch {
      return false
    }
  }

  it('preserves .s1-dev.json across version upgrade', async () => {
    const targetDir = join(installRoot, appId)
    await mkdir(targetDir, { recursive: true })
    await writeFile(
      join(targetDir, 'install.json'),
      JSON.stringify({ appId, version: '1.0.0', installedAt: '...', source: 'local', integrityVerified: true }),
    )
    await writeFile(join(targetDir, 'manifest.json'), JSON.stringify({ appId, name: 'Old', version: '1.0.0' }))
    await writeFile(join(targetDir, 'index.html'), '<html>v1</html>')
    const devLink = { distDir: '/Users/me/code/preserved/dist', enabled: true }
    await writeFile(join(targetDir, '.s1-dev.json'), JSON.stringify(devLink))

    await confirmInstall(tempDir, installRoot)

    const stillThere = await readFile(join(targetDir, '.s1-dev.json'), 'utf-8')
    expect(JSON.parse(stillThere)).toEqual(devLink)
    const newIndex = await readFile(join(targetDir, 'index.html'), 'utf-8')
    expect(newIndex).toBe('<html>v2</html>')
  })

  it('preserves data/ directory across version upgrade', async () => {
    const targetDir = join(installRoot, appId)
    await mkdir(join(targetDir, 'data'), { recursive: true })
    await writeFile(
      join(targetDir, 'install.json'),
      JSON.stringify({ appId, version: '1.0.0', installedAt: '...', source: 'local', integrityVerified: true }),
    )
    await writeFile(join(targetDir, 'manifest.json'), JSON.stringify({ appId, name: 'Old', version: '1.0.0' }))
    await writeFile(join(targetDir, 'data', 'user-notes.txt'), 'important user content')

    await confirmInstall(tempDir, installRoot)

    expect(await dirExists(join(targetDir, 'data'))).toBe(true)
    const notes = await readFile(join(targetDir, 'data', 'user-notes.txt'), 'utf-8')
    expect(notes).toBe('important user content')
  })

  it('preserves both .s1-dev.json and data/ together on upgrade', async () => {
    const targetDir = join(installRoot, appId)
    await mkdir(join(targetDir, 'data'), { recursive: true })
    await writeFile(
      join(targetDir, 'install.json'),
      JSON.stringify({ appId, version: '1.0.0', installedAt: '...', source: 'local', integrityVerified: true }),
    )
    await writeFile(join(targetDir, '.s1-dev.json'), JSON.stringify({ distDir: '/x/dist', enabled: false }))
    await writeFile(join(targetDir, 'data', 'state.json'), '{"counter":42}')

    await confirmInstall(tempDir, installRoot)

    const dev = JSON.parse(await readFile(join(targetDir, '.s1-dev.json'), 'utf-8'))
    expect(dev.distDir).toBe('/x/dist')
    expect(dev.enabled).toBe(false)
    const state = await readFile(join(targetDir, 'data', 'state.json'), 'utf-8')
    expect(state).toBe('{"counter":42}')
  })

  it('still works for fresh install (no existing target)', async () => {
    await confirmInstall(tempDir, installRoot)
    const targetDir = join(installRoot, appId)
    expect(await dirExists(targetDir)).toBe(true)
    const idx = await readFile(join(targetDir, 'index.html'), 'utf-8')
    expect(idx).toBe('<html>v2</html>')
  })
})
