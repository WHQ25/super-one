import { describe, expect, it, vi } from 'vitest'
import { readConnectionWorkspace } from './connection-workspace'

describe('connection workspace preparation', () => {
  it('starts project and harness reads together before adopting a connection', async () => {
    let projects!: (value: unknown) => void
    const client = { rpc: vi.fn(method => method === 'project.list'
      ? new Promise(resolve => { projects = resolve }) : Promise.resolve({ options: [{ provider: 'codex' }] })) }
    const pending = readConnectionWorkspace(client as never)
    expect(client.rpc.mock.calls.map(([method]) => method)).toEqual(['project.list', 'harness.options'])
    projects([{ name: 'Desktop', path: '/desktop' }])
    expect(await pending).toEqual({ projects: [{ name: 'Desktop', path: '/desktop' }], options: [{ provider: 'codex' }] })
  })
  it('rejects unavailable workspace data instead of adopting a blank workspace', async () => {
    const client = { rpc: vi.fn(async method => method === 'project.list' ? Promise.reject(new Error('Denied')) : { options: [] }) }
    await expect(readConnectionWorkspace(client as never)).rejects.toThrow('Denied')
  })
})
