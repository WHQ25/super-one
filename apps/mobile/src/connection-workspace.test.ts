import { describe, expect, it, vi } from 'vitest'
import { readConnectionWorkspace } from './connection-workspace'

describe('connection workspace preparation', () => {
  it('starts project and harness reads together before adopting a connection', async () => {
    let projects!: (value: unknown) => void
    const client = { request: vi.fn(command => command.type === 'list_projects'
      ? new Promise(resolve => { projects = resolve }) : Promise.resolve({ options: [{ provider: 'codex' }] })) }
    const pending = readConnectionWorkspace(client as never)
    expect(client.request.mock.calls.map(([command]) => command.type)).toEqual(['list_projects', 'list_harness_options'])
    projects({ projects: [{ name: 'Desktop', path: '/desktop' }] })
    expect(await pending).toEqual({ projects: [{ name: 'Desktop', path: '/desktop' }], options: [{ provider: 'codex' }] })
  })
  it('rejects unavailable workspace data instead of adopting a blank workspace', async () => {
    const client = { request: vi.fn(async command => command.type === 'list_projects' ? { error: 'Denied' } : { options: [] }) }
    await expect(readConnectionWorkspace(client as never)).rejects.toThrow('Denied')
  })
})
