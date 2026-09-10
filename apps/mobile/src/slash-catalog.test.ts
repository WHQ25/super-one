import { describe, expect, it, vi } from 'vitest'
import { requestSlashCatalog } from './slash-catalog'

type Command = { type: string }

function client(replies: Record<string, unknown>, onCall?: (type: string) => void) {
  return {
    request: vi.fn(async (command: Command) => {
      onCall?.(command.type)
      const reply = replies[command.type]
      if (reply instanceof Error) throw reply
      return reply ?? {}
    }),
  }
}

describe('requestSlashCatalog', () => {
  it('merges system commands, project commands and skills for one harness', async () => {
    const seen: string[] = []
    const catalog = await requestSlashCatalog(
      client({
        get_system_info: { userSlashCommands: [{ name: 'clear' }] },
        get_project_resources: {
          projectSlashCommands: [{ name: 'deploy', description: 'Ship' }],
          skills: [{ name: 'tdd' }],
        },
      }, (type) => seen.push(type)),
      '/work/super-one',
      'claude',
    )

    expect(catalog.slice(0, 3)).toEqual([
      { name: 'clear', description: '', argumentHint: '', isSkill: false },
      { name: 'deploy', description: 'Ship', argumentHint: '', isSkill: false },
      { name: 'tdd', description: '', argumentHint: '', isSkill: true },
    ])
    expect(seen.sort()).toEqual(['get_project_resources', 'get_system_info'])
  })

  it('offers /add-dir on a harness that accepts extra working roots', async () => {
    // A host command over a harness-neutral folder set, injected from one gate
    // the way the desktop does rather than copied into each harness catalog.
    const catalog = await requestSlashCatalog(
      client({ get_system_info: { userSlashCommands: [{ name: 'clear' }] } }),
      '/work/super-one',
      'claude',
    )
    expect(catalog.map((c) => c.name)).toEqual(['clear', 'add-dir'])
  })

  it('hides /add-dir on a harness that reads only its cwd', async () => {
    const catalog = await requestSlashCatalog(
      client({ get_system_info: { userSlashCommands: [{ name: 'clear' }] } }),
      '/work/super-one',
      'opencode',
    )
    expect(catalog.map((c) => c.name)).toEqual(['clear'])
  })

  it('lets the harness own add-dir when it reports one itself', async () => {
    // Deduped rather than listed twice — the agent's own entry carries its real
    // argument hint, and ours would shadow it.
    const catalog = await requestSlashCatalog(
      client({ get_system_info: { userSlashCommands: [{ name: 'add-dir', description: 'Harness owned' }] } }),
      '/work/super-one',
      'claude',
    )
    expect(catalog).toEqual([{ name: 'add-dir', description: 'Harness owned', argumentHint: '', isSkill: false }])
  })

  it('falls back to the legacy slashCommands field', async () => {
    const catalog = await requestSlashCatalog(
      client({ get_system_info: { slashCommands: ['resume'] } }),
      '/work/super-one',
      'claude',
    )
    expect(catalog.map((c) => c.name)).toEqual(['resume', 'add-dir'])
  })

  it('keeps system commands when project resources cannot be read', async () => {
    // A host that cannot enumerate skills still has a usable catalog; failing
    // the whole thing would read to the user as "this harness has no commands".
    const catalog = await requestSlashCatalog(
      client({
        get_system_info: { userSlashCommands: [{ name: 'clear' }] },
        get_project_resources: new Error('not supported'),
      }),
      '/work/super-one',
      'claude',
    )
    expect(catalog.map((c) => c.name)).toEqual(['clear', 'add-dir'])
  })

  it('offers /recap only for Grok ACP', async () => {
    const grok = await requestSlashCatalog(
      client({ get_system_info: { userSlashCommands: [{ name: 'clear' }] } }),
      '/work/super-one',
      'acp',
      'grok-build',
    )
    expect(grok.map((c) => c.name)).toContain('recap')
    expect(grok.map((c) => c.name)).toContain('workflows')

    const other = await requestSlashCatalog(
      client({ get_system_info: { userSlashCommands: [{ name: 'clear' }] } }),
      '/work/super-one',
      'acp',
      'opencode',
    )
    expect(other.map((c) => c.name)).not.toContain('recap')
  })

  it('rejects when system info itself fails', async () => {
    await expect(requestSlashCatalog(
      client({ get_system_info: new Error('offline') }),
      '/work/super-one',
      'claude',
    )).rejects.toThrow('offline')
  })
})
