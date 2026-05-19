import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, readdirSyncMock, readFileSyncMock, statSyncMock, rmSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
}))

const homedirMock = vi.hoisted(() => vi.fn(() => '/home/testuser'))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  statSync: statSyncMock,
  cpSync: vi.fn(),
  rmSync: rmSyncMock,
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

vi.mock('./logger', () => ({
  default: {
    warn: vi.fn(),
  },
}))

import { listSkillsFromDirs, readSkillContentFromDirs, readSkillFileFromDirs, getCodexSkillDirs, deleteCodexSkill } from './skills-service'
import type { SkillDir } from './skills-service'

describe('getCodexSkillDirs', () => {
  const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME

  beforeEach(() => {
    delete process.env.CODEX_HOME
  })

  afterEach(() => {
    if (ORIGINAL_CODEX_HOME === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = ORIGINAL_CODEX_HOME
  })

  it('covers every Codex skill root: user-installed, deprecated CODEX_HOME, embedded system, admin, and project', () => {
    const dirs = getCodexSkillDirs('/my-project')
    expect(dirs).toEqual([
      { dir: join('/home/testuser', '.agents', 'skills'), scope: 'user' },
      { dir: join('/home/testuser', '.codex', 'skills'), scope: 'user' },
      { dir: join('/home/testuser', '.codex', 'skills', '.system'), scope: 'user', readOnly: true },
      { dir: join('/etc', 'codex', 'skills'), scope: 'user', readOnly: true },
      { dir: join('/my-project', '.agents', 'skills'), scope: 'project' },
      { dir: join('/my-project', '.codex', 'skills'), scope: 'project' },
    ])
  })

  it('honors the CODEX_HOME env var for the deprecated and system skill roots', () => {
    process.env.CODEX_HOME = '/custom/codex-home'
    const dirs = getCodexSkillDirs('/my-project')
    expect(dirs).toContainEqual({ dir: join('/custom/codex-home', 'skills'), scope: 'user' })
    expect(dirs).toContainEqual({ dir: join('/custom/codex-home', 'skills', '.system'), scope: 'user', readOnly: true })
  })
})

describe('listSkillsFromDirs', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readdirSyncMock.mockReset()
    readFileSyncMock.mockReset()
  })

  it('returns empty array when no dirs exist', () => {
    existsSyncMock.mockReturnValue(false)
    const dirs: SkillDir[] = [
      { dir: '/nonexistent', scope: 'user' },
    ]

    const result = listSkillsFromDirs(dirs)
    expect(result).toEqual([])
  })

  it('discovers skills from directories with SKILL.md', () => {
    const skillDir = '/home/testuser/.agents/skills'
    const dirs: SkillDir[] = [{ dir: skillDir, scope: 'user' }]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === skillDir) return true
      if (path === join(skillDir, 'my-skill', 'SKILL.md')) return true
      if (path === join(skillDir, 'my-skill', 'config.json')) return false
      return false
    })

    readdirSyncMock.mockReturnValue([
      { name: 'my-skill', isDirectory: () => true, isSymbolicLink: () => false },
    ])

    readFileSyncMock.mockReturnValue(`---
name: My Skill
description: A test skill
---
# Content
`)

    const result = listSkillsFromDirs(dirs)
    expect(result).toEqual([
      {
        name: 'my-skill',
        displayName: 'My Skill',
        scope: 'user',
        description: 'A test skill',
        argumentHint: '',
        hasConfig: false,
      },
    ])
  })

  it('deduplicates skills by scope:name key', () => {
    const dir1 = '/dir1'
    const dir2 = '/dir2'
    const dirs: SkillDir[] = [
      { dir: dir1, scope: 'user' },
      { dir: dir2, scope: 'user' },
    ]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === dir1 || path === dir2) return true
      if (path === join(dir1, 'same-skill', 'SKILL.md') || path === join(dir2, 'same-skill', 'SKILL.md')) return true
      return false
    })

    readdirSyncMock.mockImplementation((path: string) =>
      path === dir1 || path === dir2
        ? [{ name: 'same-skill', isDirectory: () => true, isSymbolicLink: () => false }]
        : []
    )

    readFileSyncMock.mockReturnValue('---\nname: Same\ndescription: First\n---')

    const result = listSkillsFromDirs(dirs)
    // Should only include once
    expect(result).toHaveLength(1)
  })

  it('discovers nested skills recursively (Codex-style BFS) using the relative path as name', () => {
    const root = '/codex/skills'
    const dirs: SkillDir[] = [{ dir: root, scope: 'user' }]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === root) return true
      if (path === join(root, 'category', 'nested-skill', 'SKILL.md')) return true
      return false
    })

    readdirSyncMock.mockImplementation((path: string) => {
      if (path === root) return [{ name: 'category', isDirectory: () => true, isSymbolicLink: () => false }]
      if (path === join(root, 'category')) return [{ name: 'nested-skill', isDirectory: () => true, isSymbolicLink: () => false }]
      return []
    })

    readFileSyncMock.mockReturnValue('---\nname: Nested Skill\ndescription: Deep\n---')

    const result = listSkillsFromDirs(dirs)
    expect(result).toEqual([
      {
        name: 'category/nested-skill',
        displayName: 'Nested Skill',
        scope: 'user',
        description: 'Deep',
        argumentHint: '',
        hasConfig: false,
      },
    ])
  })

  it('stops descending past the Codex depth cap (6 directories)', () => {
    const root = '/r'
    const dirs: SkillDir[] = [{ dir: root, scope: 'user' }]
    // SKILL.md only at depth 7 (root/a/a/a/a/a/a/a) — beyond MAX_SCAN_DEPTH.
    const deepSkillMd = join(root, 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'SKILL.md')

    existsSyncMock.mockImplementation((path: string) => path === root || path === deepSkillMd)
    readdirSyncMock.mockReturnValue([{ name: 'a', isDirectory: () => true, isSymbolicLink: () => false }])
    readFileSyncMock.mockReturnValue('---\nname: TooDeep\ndescription: x\n---')

    expect(listSkillsFromDirs(dirs)).toEqual([])
  })

  it('skips dot-prefixed entries while descending (the .system root is scanned separately)', () => {
    const root = '/codex/skills'
    const dirs: SkillDir[] = [{ dir: root, scope: 'user' }]

    existsSyncMock.mockImplementation((path: string) => path === root)
    readdirSyncMock.mockImplementation((path: string) =>
      path === root ? [{ name: '.system', isDirectory: () => true, isSymbolicLink: () => false }] : []
    )

    expect(listSkillsFromDirs(dirs)).toEqual([])
    // .system must not even be traversed into.
    expect(readdirSyncMock).not.toHaveBeenCalledWith(join(root, '.system'), expect.anything())
  })

  it('marks skills from a readOnly root as builtin', () => {
    const sysDir = '/home/testuser/.codex/skills/.system'
    const dirs: SkillDir[] = [{ dir: sysDir, scope: 'user', readOnly: true }]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === sysDir) return true
      if (path === join(sysDir, 'imagegen', 'SKILL.md')) return true
      return false
    })
    readdirSyncMock.mockImplementation((path: string) =>
      path === sysDir ? [{ name: 'imagegen', isDirectory: () => true, isSymbolicLink: () => false }] : []
    )
    readFileSyncMock.mockReturnValue('---\nname: Image Gen\ndescription: Built-in\n---')

    const result = listSkillsFromDirs(dirs)
    expect(result).toEqual([
      {
        name: 'imagegen',
        displayName: 'Image Gen',
        scope: 'user',
        description: 'Built-in',
        argumentHint: '',
        hasConfig: false,
        builtin: true,
      },
    ])
  })

  it('handles namePrefix for plugin skills', () => {
    const skillDir = '/plugins/my-plugin/skills'
    const dirs: SkillDir[] = [
      { dir: skillDir, scope: 'user', namePrefix: 'my-plugin:' },
    ]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === skillDir) return true
      if (path === join(skillDir, 'tool', 'SKILL.md')) return true
      return false
    })

    readdirSyncMock.mockReturnValue([
      { name: 'tool', isDirectory: () => true, isSymbolicLink: () => false },
    ])

    readFileSyncMock.mockReturnValue('---\nname: Tool\ndescription: Desc\n---')

    const result = listSkillsFromDirs(dirs)
    expect(result[0].name).toBe('my-plugin:tool')
  })
})

describe('readSkillContentFromDirs', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readdirSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
  })

  it('returns null when skill not found', () => {
    existsSyncMock.mockReturnValue(false)
    const dirs: SkillDir[] = [{ dir: '/skills', scope: 'user' }]

    const result = readSkillContentFromDirs(dirs, 'missing')
    expect(result).toBeNull()
  })

  it('returns skill detail with file tree', () => {
    const skillDir = '/skills'
    const dirs: SkillDir[] = [{ dir: skillDir, scope: 'user' }]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === join(skillDir, 'my-skill', 'SKILL.md')) return true
      if (path === join(skillDir, 'my-skill', 'config.json')) return true
      return false
    })

    readFileSyncMock.mockReturnValue('---\nname: My Skill\ndescription: Test\n---')

    readdirSyncMock.mockReturnValue([
      { name: 'SKILL.md', isDirectory: () => false, isSymbolicLink: () => false },
    ])

    const result = readSkillContentFromDirs(dirs, 'my-skill')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('my-skill')
    expect(result?.displayName).toBe('My Skill')
    expect(result?.hasConfig).toBe(true)
    expect(result?.files).toBeDefined()
  })
})

describe('readSkillFileFromDirs', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
  })

  it('returns null when skill not found', () => {
    existsSyncMock.mockReturnValue(false)
    const dirs: SkillDir[] = [{ dir: '/skills', scope: 'user' }]

    const result = readSkillFileFromDirs(dirs, 'missing', 'SKILL.md')
    expect(result).toBeNull()
  })

  it('reads file content from skill directory', () => {
    const skillDir = '/skills'
    const dirs: SkillDir[] = [{ dir: skillDir, scope: 'user' }]

    existsSyncMock.mockImplementation((path: string) => {
      if (path === join(skillDir, 'my-skill', 'SKILL.md')) return true
      return false
    })

    statSyncMock.mockReturnValue({ isDirectory: () => false })
    readFileSyncMock.mockReturnValue('# SKILL content')

    const result = readSkillFileFromDirs(dirs, 'my-skill', 'SKILL.md')
    expect(result).toBe('# SKILL content')
  })

  it('prevents path traversal', () => {
    const skillDir = '/skills'
    const dirs: SkillDir[] = [{ dir: skillDir, scope: 'user' }]

    existsSyncMock.mockReturnValue(true)
    statSyncMock.mockReturnValue({ isDirectory: () => false })

    const result = readSkillFileFromDirs(dirs, 'my-skill', '../../etc/passwd')
    expect(result).toBeNull()
  })
})

describe('deleteCodexSkill', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    rmSyncMock.mockReset()
  })

  it('deletes a normal user skill', () => {
    existsSyncMock.mockReturnValue(true)
    deleteCodexSkill('my-skill', 'user', '/proj')
    expect(rmSyncMock).toHaveBeenCalledWith(
      join('/home/testuser', '.agents', 'skills', 'my-skill'),
      { recursive: true, force: true }
    )
  })

  it('refuses to delete an embedded .system skill', () => {
    existsSyncMock.mockReturnValue(true)
    deleteCodexSkill('.system/imagegen', 'user', '/proj')
    deleteCodexSkill('.system', 'user', '/proj')
    expect(rmSyncMock).not.toHaveBeenCalled()
  })

  it('refuses path-traversal skill names', () => {
    existsSyncMock.mockReturnValue(true)
    deleteCodexSkill('../../etc/passwd', 'user', '/proj')
    expect(rmSyncMock).not.toHaveBeenCalled()
  })
})
