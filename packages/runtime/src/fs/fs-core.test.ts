import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveProjectPath,
  listFilesUnderRoot,
  discoverClaudeSkillsAndCommands,
  isToolOutputRelativePath,
  toProjectRelativePath,
} from './index'

describe('resolveProjectPath', () => {
  it('rejects absolute and escaping paths', () => {
    expect(resolveProjectPath('/proj', '/etc/passwd').ok).toBe(false)
    expect(resolveProjectPath('/proj', '../outside').ok).toBe(false)
  })

  it('resolves relative path inside root', () => {
    const r = resolveProjectPath('/proj', 'src/a.ts')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.absolutePath).toContain('src')
  })

  it('keeps missing nested paths under a real project root (no join leading-sep drop)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-path-'))
    try {
      const realRoot = realpathSync(dir)
      const r = resolveProjectPath(dir, 'nested/missing/file.ts')
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(
          r.absolutePath === realRoot || r.absolutePath.startsWith(realRoot + sep),
        ).toBe(true)
        expect(r.absolutePath).toBe(join(realRoot, 'nested', 'missing', 'file.ts'))
        // Must not collapse to an absolute suffix like /nested/missing/file.ts
        expect(r.absolutePath.startsWith(`${sep}nested`)).toBe(false)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tool output path helpers', () => {
  it('accepts only temp/ relative paths', () => {
    expect(isToolOutputRelativePath('temp/job.output')).toBe(true)
    expect(isToolOutputRelativePath('temp')).toBe(true)
    expect(isToolOutputRelativePath('src/a.ts')).toBe(false)
    expect(isToolOutputRelativePath('../temp/x')).toBe(false)
    expect(isToolOutputRelativePath('temp/../src')).toBe(false)
  })

  it('maps absolute paths under project root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tool-out-'))
    try {
      const abs = join(dir, 'temp', 'a.output')
      expect(toProjectRelativePath(dir, abs)).toBe('temp/a.output')
      expect(toProjectRelativePath(dir, '/etc/passwd')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('listFilesUnderRoot', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-fs-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), '')
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x', 'i.js'), '')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists files and skips node_modules', () => {
    const files = listFilesUnderRoot(dir)
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/a.ts')
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false)
  })
})

describe('discoverClaudeSkillsAndCommands', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'core-skills-'))
    mkdirSync(join(dir, '.claude', 'skills', 'tdd'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\ndescription: Test driven\n---\n# tdd\n',
    )
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship\n---\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds project skills and commands', () => {
    const { skills, commands } = discoverClaudeSkillsAndCommands(dir, { homeDir: null })
    expect(skills.some((s) => s.name === 'tdd' && s.scope === 'project')).toBe(true)
    expect(commands.some((c) => c.name === 'ship')).toBe(true)
  })
})
