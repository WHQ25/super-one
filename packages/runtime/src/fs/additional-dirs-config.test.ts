import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'smol-toml'
import {
  addProjectAdditionalDir,
  readScopedAdditionalDirs,
  removeProjectAdditionalDir,
} from './additional-dirs-config'

describe('additional-dirs-config', () => {
  let root: string
  let project: string
  let home: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'additional-dirs-'))
    project = join(root, 'project')
    home = join(root, 'home')
    mkdirSync(project, { recursive: true })
    mkdirSync(home, { recursive: true })
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads Claude and Codex roots from separate config trees', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    mkdirSync(join(home, '.codex'), { recursive: true })
    mkdirSync(join(project, '.claude'), { recursive: true })
    mkdirSync(join(project, '.codex'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ additionalDirectories: ['/claude-user'] }))
    writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { additionalDirectories: ['/claude-project'] } }))
    writeFileSync(join(home, '.codex', 'config.toml'), '[sandbox_workspace_write]\nwritable_roots = ["/codex-user"]\n')
    writeFileSync(join(project, '.codex', 'config.toml'), '[sandbox_workspace_write]\nwritable_roots = ["/codex-project"]\n')

    expect(readScopedAdditionalDirs('claude', project, { homeDir: home })).toEqual({
      user: ['/claude-user'],
      projectShared: [],
      projectLocal: ['/claude-project'],
    })
    expect(readScopedAdditionalDirs('codex', project, { homeDir: home })).toEqual({
      user: ['/codex-user'],
      projectShared: [],
      projectLocal: ['/codex-project'],
    })
  })

  it('writes Claude project roots only to settings.local.json', () => {
    addProjectAdditionalDir('claude', project, '/shared', { homeDir: home })

    const data = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'))
    expect(data.permissions.additionalDirectories).toEqual(['/shared'])
    expect(() => readFileSync(join(project, '.codex', 'config.toml'))).toThrow()
  })

  it('writes Codex project roots only to config.toml and preserves settings', () => {
    mkdirSync(join(project, '.codex'), { recursive: true })
    writeFileSync(join(project, '.codex', 'config.toml'), 'model = "gpt-5.4"\n')

    addProjectAdditionalDir('codex', project, '/shared', { homeDir: home })

    const data = parse(readFileSync(join(project, '.codex', 'config.toml'), 'utf8')) as Record<string, any>
    expect(data.model).toBe('gpt-5.4')
    expect(data.sandbox_workspace_write.writable_roots).toEqual(['/shared'])
    expect(() => readFileSync(join(project, '.claude', 'settings.local.json'))).toThrow()
  })

  it('removes roots from the matching provider config only', () => {
    addProjectAdditionalDir('claude', project, '/shared')
    addProjectAdditionalDir('codex', project, '/shared')

    removeProjectAdditionalDir('codex', project, '/shared')

    expect(readScopedAdditionalDirs('claude', project, { homeDir: home }).projectLocal).toEqual(['/shared'])
    expect(readScopedAdditionalDirs('codex', project, { homeDir: home }).projectLocal).toEqual([])
  })
})
