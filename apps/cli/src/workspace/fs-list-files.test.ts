import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { WorkspaceFsService } from './fs-service'
import type { ProjectRegistry } from './project-registry'

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

describe('WorkspaceFsService listFiles + listSkillsAndCommands', () => {
  let dir: string
  let svc: WorkspaceFsService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 's1-list-'))
    git(dir, ['init'])
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'app.ts'), 'export {}\n')
    writeFileSync(join(dir, 'README.md'), 'hi\n')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), '')
    mkdirSync(join(dir, '.claude', 'skills', 'tdd'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\ndescription: Test driven\nargument-hint: [file]\n---\n# tdd\n',
    )
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'commands', 'ship.md'), '---\ndescription: Ship it\n---\n# ship\n')
    const projects = {
      get: () => ({ projectId: 'p1', path: dir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as ProjectRegistry
    svc = new WorkspaceFsService(projects)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists project files and skips node_modules', () => {
    const files = svc.listFiles('p1')
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/app.ts')
    expect(paths).toContain('README.md')
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false)
  })

  it('discovers project skills and commands', () => {
    const { skills, commands } = svc.listSkillsAndCommands('p1')
    expect(skills.some((s) => s.name === 'tdd' && s.isSkill)).toBe(true)
    expect(commands.some((c) => c.name === 'ship' && !c.isSkill)).toBe(true)
  })
})
