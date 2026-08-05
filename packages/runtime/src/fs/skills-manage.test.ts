import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  deleteManagedSkill,
  getManagedSkill,
  installManagedSkill,
  listManagedSkills,
  readManagedSkillFile,
} from './skills-manage'

describe('skills-manage', () => {
  let home: string
  let project: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sk-home-'))
    project = mkdtempSync(join(tmpdir(), 'sk-proj-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('lists project and user Claude skills with sourcePath', () => {
    mkdirSync(join(project, '.claude', 'skills', 'tdd'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\nname: TDD\ndescription: Test driven\n---\n# tdd\n',
    )
    mkdirSync(join(home, '.claude', 'skills', 'ship'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'skills', 'ship', 'SKILL.md'),
      '---\ndescription: Ship\n---\n# ship\n',
    )

    const skills = listManagedSkills('claude', project, { homeDir: home })
    expect(skills.map((s) => s.name).sort()).toEqual(['ship', 'tdd'])
    const tdd = skills.find((s) => s.name === 'tdd')!
    expect(tdd.scope).toBe('project')
    expect(tdd.displayName).toBe('TDD')
    expect(tdd.sourcePath).toContain('tdd')
    expect(tdd.hasConfig).toBe(false)
  })

  it('installs, reads, and deletes a project skill', () => {
    const skill = installManagedSkill(
      'claude',
      project,
      {
        scope: 'project',
        name: 'loop',
        files: {
          'SKILL.md': '---\ndescription: Loop skill\n---\n# loop\n',
          'notes.txt': 'hello',
        },
      },
      { homeDir: home },
    )
    expect(skill.name).toBe('loop')
    expect(skill.scope).toBe('project')
    expect(existsSync(join(project, '.claude', 'skills', 'loop', 'SKILL.md'))).toBe(true)

    const detail = getManagedSkill('claude', project, 'loop', skill.sourcePath, {
      homeDir: home,
    })
    expect(detail?.description).toContain('Loop')
    expect(detail?.files.some((f) => f.name === 'notes.txt')).toBe(true)

    const content = readManagedSkillFile(
      'claude',
      project,
      'loop',
      'notes.txt',
      skill.sourcePath,
      { homeDir: home },
    )
    expect(content).toBe('hello')

    deleteManagedSkill('claude', project, skill.sourcePath, { homeDir: home })
    expect(existsSync(join(project, '.claude', 'skills', 'loop'))).toBe(false)
  })

  it('refuses delete outside writable roots', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sk-out-'))
    mkdirSync(join(outside, 'evil'), { recursive: true })
    writeFileSync(join(outside, 'evil', 'SKILL.md'), '# x\n')
    expect(() =>
      deleteManagedSkill('claude', project, join(outside, 'evil'), { homeDir: home }),
    ).toThrow(/writable root/)
    rmSync(outside, { recursive: true, force: true })
  })

  it('rejects skill-name traversal when reading or loading details', () => {
    const outside = join(project, 'evil')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'SKILL.md'), '# secret\n')
    expect(getManagedSkill('claude', project, '../../evil', undefined, { homeDir: home })).toBeNull()
    expect(
      readManagedSkillFile('claude', project, '../../evil', 'SKILL.md', undefined, { homeDir: home }),
    ).toBeNull()
  })

  it('installs codex project skill under .agents/skills', () => {
    const skill = installManagedSkill(
      'codex',
      project,
      {
        scope: 'project',
        name: 'review',
        files: { 'SKILL.md': '---\ndescription: Review\n---\n' },
      },
      { homeDir: home },
    )
    expect(skill.sourcePath).toContain(join('.agents', 'skills', 'review'))
    expect(readFileSync(join(skill.sourcePath, 'SKILL.md'), 'utf8')).toContain('Review')
  })

  it('rejects install without SKILL.md', () => {
    expect(() =>
      installManagedSkill(
        'claude',
        project,
        { scope: 'user', name: 'x', files: { 'README.md': 'nope' } },
        { homeDir: home },
      ),
    ).toThrow(/SKILL\.md/)
  })
})
