import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveProjectPath } from './path-security'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'path-sec-'))
  dirs.push(d)
  return d
}

describe('resolveProjectPath', () => {
  it('allows nested relative paths inside root', () => {
    const root = temp()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'x')
    const r = resolveProjectPath(root, 'src/a.ts')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.absolutePath).toContain('a.ts')
  })

  it('rejects absolute paths and traversal', () => {
    const root = temp()
    expect(resolveProjectPath(root, '/etc/passwd').ok).toBe(false)
    expect(resolveProjectPath(root, '../outside').ok).toBe(false)
    expect(resolveProjectPath(root, 'foo/../../outside').ok).toBe(false)
  })

  it('rejects symlink that escapes project root', () => {
    const root = temp()
    const outside = temp()
    writeFileSync(join(outside, 'secret'), 'nope')
    symlinkSync(outside, join(root, 'link'))
    const r = resolveProjectPath(root, 'link/secret')
    expect(r.ok).toBe(false)
  })
})
