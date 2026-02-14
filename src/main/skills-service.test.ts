import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, readdirSyncMock, readFileSyncMock, statSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}))

const homedirMock = vi.hoisted(() => vi.fn(() => '/home/testuser'))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  statSync: statSyncMock,
  cpSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

import { listSkillsFromDirs, readSkillContentFromDirs, readSkillFileFromDirs, getCodexSkillDirs } from './skills-service'
import type { SkillDir } from './skills-service'

describe('getCodexSkillDirs', () => {
  it('returns user and project dirs for Codex', () => {
    const dirs = getCodexSkillDirs('/my-project')
    expect(dirs).toEqual([
      { dir: join('/home/testuser', '.agents', 'skills'), scope: 'user' },
      { dir: join('/my-project', '.agents', 'skills'), scope: 'project' },
    ])
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
      if (path.endsWith('SKILL.md')) return true
      return false
    })

    readdirSyncMock.mockReturnValue([
      { name: 'same-skill', isDirectory: () => true, isSymbolicLink: () => false },
    ])

    readFileSyncMock.mockReturnValue('---\nname: Same\ndescription: First\n---')

    const result = listSkillsFromDirs(dirs)
    // Should only include once
    expect(result).toHaveLength(1)
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
