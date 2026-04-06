import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { generateIntegrity, verifyIntegrity } from './miniapp-packager'

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

    it('should exclude integrity.json and install.json', async () => {
      await writeFile(join(appDir, 'integrity.json'), '{}')
      await writeFile(join(appDir, 'install.json'), '{}')
      const integrity = await generateIntegrity(appDir)
      expect(integrity.files).not.toHaveProperty('integrity.json')
      expect(integrity.files).not.toHaveProperty('install.json')
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
