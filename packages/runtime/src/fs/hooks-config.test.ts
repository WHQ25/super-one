import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deleteHook, listHooks, saveHook } from './hooks-config'

describe('hooks-config', () => {
  let home: string
  let project: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'hooks-home-'))
    project = mkdtempSync(join(tmpdir(), 'hooks-proj-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('lists hooks from user, project, and local scopes', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash' }] }],
        },
      }),
    )
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
        },
      }),
    )
    writeFileSync(
      join(project, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'prompt', prompt: 'verify' }] }],
        },
      }),
    )

    const result = listHooks(project, { homeDir: home })
    expect(result).toHaveLength(3)
    expect(result.map((h) => h.id).sort()).toEqual([
      'local:PostToolUse:0:0',
      'project:Stop:0:0',
      'user:PreToolUse:0:0',
    ])
  })

  it('saves a project hook into settings.json', () => {
    saveHook(
      project,
      {
        scope: 'project',
        event: 'Stop',
        entry: { type: 'command', command: 'echo done' },
      },
      undefined,
      { homeDir: home },
    )
    const written = JSON.parse(
      readFileSync(join(project, '.claude', 'settings.json'), 'utf-8'),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
    expect(written.hooks.Stop?.[0]?.hooks?.[0]?.command).toBe('echo done')
    expect(listHooks(project, { homeDir: home })).toHaveLength(1)
  })

  it('deletes a hook by stable id', () => {
    saveHook(
      project,
      {
        scope: 'project',
        event: 'Stop',
        entry: { type: 'command', command: 'echo done' },
      },
      undefined,
      { homeDir: home },
    )
    const listed = listHooks(project, { homeDir: home })
    deleteHook(project, listed[0]!.id, { homeDir: home })
    expect(listHooks(project, { homeDir: home })).toEqual([])
  })
})
