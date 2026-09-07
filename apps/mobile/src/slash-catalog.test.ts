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

    expect(catalog).toEqual([
      { name: 'clear', description: '', argumentHint: '', isSkill: false },
      { name: 'deploy', description: 'Ship', argumentHint: '', isSkill: false },
      { name: 'tdd', description: '', argumentHint: '', isSkill: true },
    ])
    expect(seen.sort()).toEqual(['get_project_resources', 'get_system_info'])
  })

  it('falls back to the legacy slashCommands field', async () => {
    const catalog = await requestSlashCatalog(
      client({ get_system_info: { slashCommands: ['resume'] } }),
      '/work/super-one',
      'claude',
    )
    expect(catalog.map((c) => c.name)).toEqual(['resume'])
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
    expect(catalog.map((c) => c.name)).toEqual(['clear'])
  })

  it('rejects when system info itself fails', async () => {
    await expect(requestSlashCatalog(
      client({ get_system_info: new Error('offline') }),
      '/work/super-one',
      'claude',
    )).rejects.toThrow('offline')
  })
})
