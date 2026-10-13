import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  deleteManagedSkill,
  getCodexSkillDirs,
  getManagedSkill,
  listManagedSkills,
  readManagedSkillFile,
} from './skills-manage'

/** Skill roots, nesting and deletion bounds the settings pages rely on. */
describe('skill roots', () => {
  let home: string
  let project: string
  let codexHome: string
  const opts = () => ({ homeDir: home, codexHome })

  function skill(dir: string, displayName = 'S'): string {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${displayName}\ndescription: d\n---\n# body\n`)
    return dir
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sk-roots-home-'))
    project = mkdtempSync(join(tmpdir(), 'sk-roots-proj-'))
    codexHome = join(home, '.codex')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('covers every Codex root: user-installed, CODEX_HOME, embedded system, admin and project', () => {
    expect(getCodexSkillDirs('/my-project', opts())).toEqual([
      { dir: join(home, '.agents', 'skills'), scope: 'user' },
      { dir: join(codexHome, 'skills'), scope: 'user' },
      { dir: join(codexHome, 'skills', '.system'), scope: 'user', readOnly: true },
      ...(process.platform === 'win32' ? [] : [{ dir: join('/etc', 'codex', 'skills'), scope: 'user', readOnly: true }]),
      { dir: join('/my-project', '.agents', 'skills'), scope: 'project' },
      { dir: join('/my-project', '.codex', 'skills'), scope: 'project' },
    ])
  })

  it('lists same-named skills of different roots apart, nested ones by relative path', () => {
    const agents = skill(join(home, '.agents', 'skills', 'same'))
    const codex = skill(join(codexHome, 'skills', 'same'))
    skill(join(codexHome, 'skills', 'category', 'nested'), 'Nested')
    skill(join(codexHome, 'skills', 'a', 'a', 'a', 'a', 'a', 'a', 'a'), 'Too deep')
    skill(join(codexHome, 'skills', '.hidden', 'x'))

    const listed = listManagedSkills('codex', project, opts())
    expect(listed.filter((s) => s.name === 'same').map((s) => s.sourcePath)).toEqual([agents, codex])
    expect(listed.find((s) => s.name === 'category/nested')).toMatchObject({ displayName: 'Nested', scope: 'user' })
    expect(listed.map((s) => s.displayName)).not.toContain('Too deep')
    expect(listed.map((s) => s.name)).not.toContain('.hidden/x')
  })

  it('marks embedded system skills builtin and plugin skills by their prefix only', () => {
    skill(join(codexHome, 'skills', '.system', 'imagegen'), 'Image Gen')
    expect(listManagedSkills('codex', project, opts()).find((s) => s.name === 'imagegen')).toMatchObject({ builtin: true })

    const installPath = join(home, 'plugins', 'demo')
    skill(join(installPath, 'skills', 'tool'))
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      plugins: { 'demo@mp': [{ scope: 'user', installPath }] },
    }))
    const tool = listManagedSkills('claude', project, opts()).find((s) => s.name === 'demo:tool')
    expect(tool).toBeDefined()
    expect(tool).not.toHaveProperty('builtin')
  })

  it('reads the requested root of a same-named skill and echoes its sourcePath', () => {
    skill(join(home, '.agents', 'skills', 'same'))
    const second = skill(join(codexHome, 'skills', 'same'))

    expect(getManagedSkill('codex', project, 'same', undefined, opts())?.sourcePath).toBe(join(home, '.agents', 'skills', 'same'))
    // A resolve-equal spelling (an app-server path) comes back verbatim.
    expect(getManagedSkill('codex', project, 'same', second + sep, opts())?.sourcePath).toBe(second + sep)
    expect(readManagedSkillFile('codex', project, 'same', 'SKILL.md', second, opts())).toContain('# body')
    expect(readManagedSkillFile('codex', project, 'same', '../../etc/passwd', undefined, opts())).toBeNull()
  })

  it('deletes by exact sourcePath only inside a writable root and only a skill folder', () => {
    const user = skill(join(codexHome, 'skills', 'mine'))
    const projectSkill = skill(join(project, '.agents', 'skills', 'team'))
    const system = skill(join(codexHome, 'skills', '.system', 'imagegen'))
    const notSkill = join(codexHome, 'skills', 'not-a-skill')
    mkdirSync(notSkill, { recursive: true })

    deleteManagedSkill('codex', project, user, opts())
    deleteManagedSkill('codex', project, projectSkill, opts())
    expect(existsSync(user) || existsSync(projectSkill)).toBe(false)

    for (const target of [system, join(codexHome, 'skills', '.system'), join(home, '.agents', 'skills', '..', '..', 'etc')]) {
      expect(() => deleteManagedSkill('codex', project, target, opts())).toThrow(expect.objectContaining({ code: 'forbidden' }))
    }
    expect(() => deleteManagedSkill('codex', project, notSkill, opts())).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(existsSync(system) && existsSync(notSkill)).toBe(true)
  })
})
