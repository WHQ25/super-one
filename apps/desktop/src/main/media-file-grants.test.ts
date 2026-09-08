import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaFileGrants } from './media-file-grants'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('completed download media access', () => {
  it('survives restart without allowing sibling files or a substituted symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-grants-test-'))
    dirs.push(dir)
    const file = join(dir, 'download.png')
    const sibling = join(dir, 'private.png')
    const manifest = join(dir, 'grants.json')
    writeFileSync(file, 'image')
    writeFileSync(sibling, 'private')
    new MediaFileGrants(manifest).add(file)
    const restored = new MediaFileGrants(manifest)
    expect(restored.has(file)).toBe(true)
    expect(restored.has(sibling)).toBe(false)
    unlinkSync(file)
    symlinkSync(sibling, file)
    expect(restored.has(file)).toBe(false)
    expect(new MediaFileGrants(manifest).has(file)).toBe(false)
  })
})
