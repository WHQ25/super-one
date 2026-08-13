import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverCursorSkillsAndCommands, stripMarkdownFrontmatter } from './cursor-skills-discover'

function writeSkill(root: string, name: string, body: string) {
  const dir = join(root, '.cursor', 'skills', name)
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
