import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverCursorSkillsAndCommands, stripMarkdownFrontmatter } from './cursor-skills-discover'

function writeSkill(root: string, name: string, body: string) {
  const dir = join(root, '.cursor', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
}

function writeAgentsSkill(root: string, name: string, body: string) {
  const dir = join(root, '.agents', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
}

function writeCommand(root: string, name: string, body: string) {
  const dir = join(root, '.cursor', 'commands')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), body)
}

describe('discoverCursorSkillsAndCommands', () => {
  it('strips YAML frontmatter from command bodies', () => {
    expect(stripMarkdownFrontmatter('---\ndescription: x\n---\n\nDo the thing.')).toBe('Do the thing.')
    expect(stripMarkdownFrontmatter('plain prompt')).toBe('plain prompt')
  })

  it('lists project skills and commands', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-'))
    writeSkill(project, 'review', '---\ndescription: Review the diff\narguments: [files]\n---\n')
    writeCommand(project, 'ship', '---\ndescription: Ship it\n---\n\nShip the current branch.')

    const items = discoverCursorSkillsAndCommands(project, { homeDir: join(project, 'no-home') })
    expect(items).toEqual([
      {
        name: 'review',
        description: 'Review the diff',
        argumentHint: '[files]',
        isSkill: true,
      },
      {
        name: 'ship',
        description: 'Ship it',
        argumentHint: '',
        isSkill: false,
        promptBody: 'Ship the current branch.',
      },
    ])
  })

  it('lets project entries override the same user-level name', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-proj-'))
    const home = mkdtempSync(join(tmpdir(), 'cursor-slash-home-'))
    writeSkill(home, 'review', '---\ndescription: User review\n---\n')
    writeSkill(project, 'review', '---\ndescription: Project review\n---\n')
    writeCommand(home, 'ship', '---\ndescription: User ship\n---\nUser body')
    writeCommand(project, 'ship', '---\ndescription: Project ship\n---\nProject body')

    const items = discoverCursorSkillsAndCommands(project, { homeDir: home })
    expect(items.find((item) => item.name === 'review')).toMatchObject({
      description: 'Project review',
      isSkill: true,
    })
    expect(items.find((item) => item.name === 'ship')).toMatchObject({
      description: 'Project ship',
      promptBody: 'Project body',
    })
  })

  it('lists project skills under .agents/skills', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-agents-'))
    writeAgentsSkill(project, 'release', '---\ndescription: Ship a release\n---\n')

    const items = discoverCursorSkillsAndCommands(project, { homeDir: '' })
    expect(items).toEqual([
      {
        name: 'release',
        description: 'Ship a release',
        argumentHint: '',
        isSkill: true,
      },
    ])
  })

  it('lets a .cursor skill override the same .agents name, and a project .agents skill override a user skill', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-agents-proj-'))
    const home = mkdtempSync(join(tmpdir(), 'cursor-slash-agents-home-'))
    writeSkill(project, 'review', '---\ndescription: Cursor review\n---\n')
    writeAgentsSkill(project, 'review', '---\ndescription: Agents review\n---\n')
    writeAgentsSkill(project, 'release', '---\ndescription: Project release\n---\n')
    writeSkill(home, 'release', '---\ndescription: User release\n---\n')

    const items = discoverCursorSkillsAndCommands(project, { homeDir: home })
    expect(items.find((item) => item.name === 'review')).toMatchObject({ description: 'Cursor review' })
    expect(items.find((item) => item.name === 'release')).toMatchObject({ description: 'Project release' })
    expect(items.filter((item) => item.name === 'review')).toHaveLength(1)
    expect(items.filter((item) => item.name === 'release')).toHaveLength(1)
  })

  it('lists a symlinked user skill ahead of project skills', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-user-link-'))
    const home = mkdtempSync(join(tmpdir(), 'cursor-slash-user-link-home-'))
    writeAgentsSkill(project, 'release', '---\ndescription: Project release\n---\n')
    writeAgentsSkill(home, 'find-skills', '---\ndescription: Find a skill\n---\n')
    const cursorSkills = join(home, '.cursor', 'skills')
    mkdirSync(cursorSkills, { recursive: true })
    symlinkSync(join(home, '.agents', 'skills', 'find-skills'), join(cursorSkills, 'find-skills'))

    const skills = discoverCursorSkillsAndCommands(project, { homeDir: home }).filter((item) => item.isSkill)
    expect(skills.map((item) => item.name)).toEqual(['find-skills', 'release'])
    expect(skills[0]).toMatchObject({ description: 'Find a skill' })
  })

  it('follows a symlinked skill folder', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-link-'))
    writeAgentsSkill(project, 'find-skills', '---\ndescription: Find a skill\n---\n')
    const cursorSkills = join(project, '.cursor', 'skills')
    mkdirSync(cursorSkills, { recursive: true })
    symlinkSync(join(project, '.agents', 'skills', 'find-skills'), join(cursorSkills, 'find-skills'))

    const items = discoverCursorSkillsAndCommands(project, { homeDir: '' })
    expect(items.filter((item) => item.name === 'find-skills')).toEqual([
      {
        name: 'find-skills',
        description: 'Find a skill',
        argumentHint: '',
        isSkill: true,
      },
    ])
  })

  it('ignores Claude skill directories', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-claude-'))
    mkdirSync(join(project, '.claude', 'skills', 'tdd'), { recursive: true })
    writeFileSync(join(project, '.claude', 'skills', 'tdd', 'SKILL.md'), '---\ndescription: TDD\n---\n')
    writeSkill(project, 'cursor-only', '---\ndescription: Cursor\n---\n')

    const names = discoverCursorSkillsAndCommands(project, { homeDir: '' }).map((item) => item.name)
    expect(names).toEqual(['cursor-only'])
  })

  it('lists a skill and a command that share a name as two entries', () => {
    const project = mkdtempSync(join(tmpdir(), 'cursor-slash-dup-'))
    writeSkill(project, 'review', '---\ndescription: Skill review\n---\n')
    writeCommand(project, 'review', '---\ndescription: Command review\n---\nReview the diff.')

    const items = discoverCursorSkillsAndCommands(project, { homeDir: '' })
    expect(items).toEqual([
      {
        name: 'review',
        description: 'Skill review',
        argumentHint: '',
        isSkill: true,
      },
      {
        name: 'review',
        description: 'Command review',
        argumentHint: '',
        isSkill: false,
        promptBody: 'Review the diff.',
      },
    ])
  })
})
