import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deletePlugin, listPlugins, readPluginContent, readPluginFile } from './plugins-manage'

describe('plugins-manage', () => {
  let home: string
  let project: string
  let installPath: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'plug-home-'))
    project = mkdtempSync(join(tmpdir(), 'plug-proj-'))
    installPath = join(home, '.claude', 'plugins', 'cache', 'mp', 'demo', '1.0')
    mkdirSync(join(installPath, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', description: 'Demo plugin', author: { name: 'Ada' } }),
    )
    writeFileSync(join(installPath, 'README.md'), '# demo\n')
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 1,
        plugins: {
          'demo@mp': [
            {
              scope: 'user',
              installPath,
              version: '1.0',
              installedAt: '2024-01-01T00:00:00.000Z',
            },
            {
              scope: 'project',
              installPath,
              version: '1.0',
              projectPath: project,
            },
          ],
        },
      }),
    )
    writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), '{}')
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('lists user and matching project plugins', () => {
    const listed = listPlugins(project, { homeDir: home })
    expect(listed).toHaveLength(2)
    expect(listed.map((p) => p.scope).sort()).toEqual(['project', 'user'])
    expect(listed[0]!.name).toBe('demo')
    expect(listed[0]!.key).toBe('demo@mp')
  })

  it('reads plugin detail and file content', () => {
    const detail = readPluginContent(project, 'demo@mp', { homeDir: home })
    expect(detail?.description).toBe('Demo plugin')
    expect(detail?.author).toBe('Ada')
    expect(detail?.files.some((f) => f.name === 'README.md')).toBe(true)

    const content = readPluginFile(project, 'demo@mp', 'README.md', { homeDir: home })
    expect(content).toContain('# demo')
  })

  it('deletes a project-scoped install entry', () => {
    deletePlugin('demo@mp', 'project', project, { homeDir: home })
    const listed = listPlugins(project, { homeDir: home })
    expect(listed).toHaveLength(1)
    expect(listed[0]!.scope).toBe('user')
  })
})
