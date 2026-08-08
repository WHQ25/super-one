import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, readdirSyncMock, readFileSyncMock, homedirMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  homedirMock: vi.fn(() => '/home/user'),
}))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

import {
  scanCommandDir,
  discoverSkills,
  discoverAllAgents,
  readAgentFile,
  discoverUserCommands,
  discoverProjectCommands,
  discoverCodexUserPrompts,
} from './discover-resources'

function dirent(name: string, isFile = true) {
  return { name, isFile: () => isFile, isDirectory: () => !isFile }
}

beforeEach(() => {
  existsSyncMock.mockReset()
  readdirSyncMock.mockReset()
  readFileSyncMock.mockReset()
  homedirMock.mockReset().mockReturnValue('/home/user')
})

describe('parseFrontmatter (via scanCommandDir)', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('test.md')])
  })

  it('parses standard YAML key-value pairs', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: A test command\nargument-hint: <file>\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result).toEqual([
      { name: 'test', description: 'A test command', argumentHint: '<file>', isSkill: false },
    ])
  })

  it('reads arguments frontmatter as argumentHint for commands', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: Deploy\narguments: <env>\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result).toEqual([
      { name: 'test', description: 'Deploy', argumentHint: '<env>', isSkill: false },
    ])
  })

  it('parses multi-line continuation values', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: Line one\n  continued here\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('Line one continued here')
  })

  it('handles block scalar indicator >', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: >\n  folded text\n  more text\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('folded text more text')
  })

  it('handles block scalar indicator |', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: |\n  literal text\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('literal text')
  })

  it('handles block scalar indicator >-', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: >-\n  stripped folded\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('stripped folded')
  })

  it('handles block scalar indicator |-', () => {
    readFileSyncMock.mockReturnValue(
      '---\ndescription: |-\n  stripped literal\n---\nBody',
    )
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('stripped literal')
  })

  it('returns empty description when no frontmatter', () => {
    readFileSyncMock.mockReturnValue('# My Heading\nSome body text')
    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('My Heading')
  })
})

describe('scanCommandDir', () => {
  it('returns empty array when dir does not exist', () => {
    existsSyncMock.mockReturnValue(false)
    expect(scanCommandDir('/nonexistent')).toEqual([])
  })

  it('scans .md files and extracts info from frontmatter', () => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('deploy.md'), dirent('review.md')])
    readFileSyncMock
      .mockReturnValueOnce('---\ndescription: Deploy app\nargument-hint: <env>\n---\n')
      .mockReturnValueOnce('---\ndescription: Review code\n---\n')

    const result = scanCommandDir('/commands')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      name: 'deploy',
      description: 'Deploy app',
      argumentHint: '<env>',
      isSkill: false,
    })
    expect(result[1]).toEqual({
      name: 'review',
      description: 'Review code',
      argumentHint: '',
      isSkill: false,
    })
  })

  it('falls back to first heading for description when no frontmatter', () => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('help.md')])
    readFileSyncMock.mockReturnValue('# Get Help\nSome instructions')

    const result = scanCommandDir('/commands')
    expect(result[0].description).toBe('Get Help')
  })

  it('applies namePrefix to command names', () => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('lint.md')])
    readFileSyncMock.mockReturnValue('---\ndescription: Lint code\n---\n')

    const result = scanCommandDir('/commands', 'myplugin:')
    expect(result[0].name).toBe('myplugin:lint')
  })

  it('ignores non-.md files', () => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('readme.txt'), dirent('config.json')])
    readFileSyncMock.mockReturnValue('')

    const result = scanCommandDir('/commands')
    expect(result).toEqual([])
  })

  it('ignores directories', () => {
    existsSyncMock.mockReturnValue(true)
    readdirSyncMock.mockReturnValue([dirent('subdir', false)])
    const result = scanCommandDir('/commands')
    expect(result).toEqual([])
  })
})

describe('discoverSkills', () => {
  it('combines user and project skills, dedupes by name (first wins)', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return p === '/home/user/.claude/skills' || p === '/project/.claude/skills'
    })

    const userSkillMd = '---\ndescription: User skill\n---\n'
    const projectSkillMd = '---\ndescription: Project skill\n---\n'
    const duplicateSkillMd = '---\ndescription: Project duplicate\n---\n'

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === '/home/user/.claude/skills') return [dirent('shared', false)]
      if (dir === '/project/.claude/skills') return [dirent('shared', false), dirent('projonly', false)]
      return []
    })

    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      if (p === '/home/user/.claude/skills') return true
      if (p === '/project/.claude/skills') return true
      if (p === '/home/user/.claude/skills/shared/SKILL.md') return true
      if (p === '/project/.claude/skills/shared/SKILL.md') return true
      if (p === '/project/.claude/skills/projonly/SKILL.md') return true
      return false
    })

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === '/home/user/.claude/skills/shared/SKILL.md') return userSkillMd
      if (p === '/project/.claude/skills/shared/SKILL.md') return duplicateSkillMd
      if (p === '/project/.claude/skills/projonly/SKILL.md') return projectSkillMd
      return ''
    })

    const result = discoverSkills('/project')
    const names = result.map((s) => s.name)
    expect(names).toContain('shared')
    expect(names).toContain('projonly')
    const shared = result.find((s) => s.name === 'shared')!
    expect(shared.description).toBe('User skill')
    expect(result).toHaveLength(2)
  })

  it('reads arguments frontmatter as argumentHint', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return p === '/home/user/.claude/skills' || p === '/home/user/.claude/skills/release/SKILL.md'
    })
    readdirSyncMock.mockReturnValue([dirent('release', false)])
    readFileSyncMock.mockReturnValue('---\ndescription: Release app\narguments: "[channel] [bump]"\n---\n')

    const result = discoverSkills('/project')
    expect(result[0]).toMatchObject({ name: 'release', argumentHint: '[channel] [bump]' })
  })

  it('prefers arguments over argument-hint for skills', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return p === '/home/user/.claude/skills' || p === '/home/user/.claude/skills/deploy/SKILL.md'
    })
    readdirSyncMock.mockReturnValue([dirent('deploy', false)])
    readFileSyncMock.mockReturnValue('---\narguments: <env>\nargument-hint: <old>\n---\n')

    const result = discoverSkills('/project')
    expect(result[0]?.argumentHint).toBe('<env>')
  })
})

describe('discoverAllAgents', () => {
  it('project agents first, user agents second, dedupes by name, adds scope tag', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return (
        p === '/project/.claude/agents' ||
        p === '/home/user/.claude/agents'
      )
    })

    readdirSyncMock.mockImplementation((dir: string) => {
      if (typeof dir === 'string' && dir === '/project/.claude/agents')
        return [dirent('coder.md')]
      if (typeof dir === 'string' && dir === '/home/user/.claude/agents')
        return [dirent('coder.md'), dirent('reviewer.md')]
      return []
    })

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === '/project/.claude/agents/coder.md')
        return '---\ndescription: Project coder\n---\n'
      if (p === '/home/user/.claude/agents/coder.md')
        return '---\ndescription: User coder\n---\n'
      if (p === '/home/user/.claude/agents/reviewer.md')
        return '---\ndescription: Code reviewer\n---\n'
      return ''
    })

    const result = discoverAllAgents('/project')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'coder', scope: 'project', description: 'Project coder' })
    expect(result[1]).toMatchObject({ name: 'reviewer', scope: 'user', description: 'Code reviewer' })
  })
})

describe('readAgentFile', () => {
  it('checks project first, then user, then plugins', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p === '/project/.claude/agents/coder.md') return true
      return false
    })
    readFileSyncMock.mockReturnValue('Project agent content')

    const result = readAgentFile('/project', 'coder')
    expect(result).toBe('Project agent content')
  })

  it('falls back to user-level when not found in project', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p === '/project/.claude/agents/coder.md') return false
      if (p === '/home/user/.claude/agents/coder.md') return true
      return false
    })
    readFileSyncMock.mockReturnValue('User agent content')

    const result = readAgentFile('/project', 'coder')
    expect(result).toBe('User agent content')
  })

  it('strips plugin prefix for path resolution', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins/installed_plugins.json')) return true
      if (p === '/plugins/myplug/agents/helper.md') return true
      return false
    })
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json'))
        return JSON.stringify({
          plugins: { 'myplug@1.0': [{ scope: 'user', installPath: '/plugins/myplug' }] },
        })
      return 'Plugin agent content'
    })

    const result = readAgentFile('/project', 'myplug:helper')
    expect(result).toBe('Plugin agent content')
  })

  it('returns null when agent not found anywhere', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json')) return false
      return false
    })

    const result = readAgentFile('/project', 'nonexistent')
    expect(result).toBeNull()
  })
})

describe('discoverUserCommands', () => {
  it('reads commands from ~/.claude/commands', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return p === '/home/user/.claude/commands'
    })
    readdirSyncMock.mockReturnValue([dirent('fix.md')])
    readFileSyncMock.mockReturnValue('---\ndescription: Fix issues\n---\n')

    const result = discoverUserCommands()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'fix', description: 'Fix issues' })
  })

  it('includes user-scoped plugin commands with prefix', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json')) return true
      if (p === '/home/user/.claude/commands') return false
      if (p === '/plugins/cool/commands') return true
      return false
    })
    readdirSyncMock.mockImplementation((dir: string) => {
      if (typeof dir === 'string' && dir === '/plugins/cool/commands')
        return [dirent('build.md')]
      return []
    })
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json'))
        return JSON.stringify({
          plugins: { 'cool@2.0': [{ scope: 'user', installPath: '/plugins/cool' }] },
        })
      return '---\ndescription: Build project\n---\n'
    })

    const result = discoverUserCommands()
    expect(result.some((c) => c.name === 'cool:build')).toBe(true)
  })
})

describe('discoverCodexUserPrompts', () => {
  it('reads top-level .md files from ~/.codex/prompts', () => {
    existsSyncMock.mockImplementation((p: string) => p === '/home/user/.codex/prompts')
    readdirSyncMock.mockReturnValue([dirent('align.md'), dirent('tdd.md')])
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('align.md')) return '---\ndescription: Align requirements\n---\n'
      if (p.endsWith('tdd.md')) return '---\ndescription: TDD workflow\n---\n'
      return ''
    })

    const result = discoverCodexUserPrompts()
    expect(result).toEqual([
      { name: 'align', description: 'Align requirements', argumentHint: '', isSkill: false },
      { name: 'tdd', description: 'TDD workflow', argumentHint: '', isSkill: false },
    ])
  })

  it('returns empty when ~/.codex/prompts does not exist', () => {
    existsSyncMock.mockReturnValue(false)
    expect(discoverCodexUserPrompts()).toEqual([])
  })
})

describe('discoverProjectCommands', () => {
  it('reads commands from {cwd}/.claude/commands', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('plugins')) return false
      return p === '/myproj/.claude/commands'
    })
    readdirSyncMock.mockReturnValue([dirent('deploy.md')])
    readFileSyncMock.mockReturnValue('---\ndescription: Deploy\n---\n')

    const result = discoverProjectCommands('/myproj')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'deploy', description: 'Deploy' })
  })

  it('includes project-scoped plugin commands with prefix', () => {
    existsSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json')) return true
      if (p === '/myproj/.claude/commands') return false
      if (p === '/plugins/proj-tool/commands') return true
      return false
    })
    readdirSyncMock.mockImplementation((dir: string) => {
      if (typeof dir === 'string' && dir === '/plugins/proj-tool/commands')
        return [dirent('test.md')]
      return []
    })
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.includes('installed_plugins.json'))
        return JSON.stringify({
          plugins: {
            'proj-tool@1.0': [
              { scope: 'project', installPath: '/plugins/proj-tool', projectPath: '/myproj' },
            ],
          },
        })
      return '---\ndescription: Run tests\n---\n'
    })

    const result = discoverProjectCommands('/myproj')
    expect(result.some((c) => c.name === 'proj-tool:test')).toBe(true)
  })
})
