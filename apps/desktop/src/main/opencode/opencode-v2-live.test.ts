import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpHttpConfig: () => null, getSuperoneMcpStdioConfig: () => null }))

import { OpenCodeV2Client } from './opencode-v2-client'
import { createOpenCodeV2Runtime } from './opencode-v2-runtime'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const baseUrl = process.env.SUPERONE_OPENCODE_SMOKE_URL
const directory = process.env.SUPERONE_OPENCODE_SMOKE_DIRECTORY

/** Opt-in against a private test server and temporary location; never runs a model.
 * The location must contain .agents/skills/sdk-smoke/SKILL.md with name: sdk-smoke.
 */
describe('OpenCode V2 live client smoke', () => {
  it.skipIf(!baseUrl || !directory)('reloads agents, skills and commands in the same native session', async () => {
    const client = new OpenCodeV2Client({ baseUrl: baseUrl!, directory: directory!, password: process.env.SUPERONE_OPENCODE_SMOKE_PASSWORD })
    const roots = ['.opencode/agents', '.opencode/commands', '.agents/skills/catalog-smoke'].map((path) => join(directory!, path))
    const session = await client.createSession([])
    const runtime = await createOpenCodeV2Runtime({ url: baseUrl!, password: process.env.SUPERONE_OPENCODE_SMOKE_PASSWORD, protocol: 'v2', exited: null, close: async () => {} }, {
      sessionId: 'catalog-smoke', providerSessionId: session.id, cwd: directory!, config: {}, permissionMode: 'default', onEvent: () => {},
    })
    try {
      for (const root of roots) await mkdir(root, { recursive: true })
      await writeFile(join(roots[0], 'catalog-smoke.md'), '---\ndescription: Native reload fixture\nmode: primary\n---\nOffline reload test.\n')
      await writeFile(join(roots[1], 'catalog-smoke.md'), '---\ndescription: Native reload command\n---\nReview $ARGUMENTS.\n')
      await writeFile(join(roots[2], 'SKILL.md'), '---\nname: catalog-smoke\ndescription: Native reload skill\n---\nOffline reload test.\n')
      const refreshed = await runtime.refreshResources!()
      expect(refreshed.agents).toContainEqual(expect.objectContaining({ id: 'catalog-smoke' }))
      expect(runtime.sessionId).toBe(session.id)
      await vi.waitFor(async () => {
        const resources = await client.resources()
        expect(resources.agents).toContainEqual(expect.objectContaining({ id: 'catalog-smoke' }))
        expect(resources.commands).toContainEqual(expect.objectContaining({ name: 'catalog-smoke', isSkill: false }))
        expect(await client.skills()).toContainEqual(expect.objectContaining({ name: 'catalog-smoke' }))
      }, { timeout: 5000 })
      expect((await client.getSession(session.id)).id).toBe(session.id)
    } finally {
      await runtime.close()
      await rm(join(roots[0], 'catalog-smoke.md'), { force: true })
      await rm(join(roots[1], 'catalog-smoke.md'), { force: true })
      await rm(roots[2], { recursive: true, force: true })
      await client.deleteSession(session.id)
    }
  }, 15000)
  it.skipIf(!baseUrl || !directory)('discovers resources, runs a shell, and manages sessions with the published client', async () => {
    const client = new OpenCodeV2Client({
      baseUrl: baseUrl!, directory: directory!, password: process.env.SUPERONE_OPENCODE_SMOKE_PASSWORD,
    })
    const resources = await client.resources()
    expect(resources.agents.some((agent) => agent.id === 'build')).toBe(true)
    const abort = new AbortController()
    const stream = await client.eventStream(abort.signal)
    const types: string[] = []
    const enqueued: unknown[] = []
    const drained = (async () => {
      for await (const event of stream) {
        types.push(event.type)
        if (event.type === 'session.inbox.enqueued') enqueued.push(event.data)
      }
    })()
    const sessions: string[] = []
    try {
      const session = await client.createSession([])
      sessions.push(session.id)
      await client.updateSession(session.id, { title: 'SuperOne SDK smoke' })
      await client.putInstruction(session.id, 'superone', 'Offline client smoke; do not invoke a model.')
      await client.switchAgent(session.id, 'plan')
      expect((await client.getSession(session.id)).agent).toBe('plan')
      expect(await client.permissions(session.id)).toEqual([])
      expect(await client.forms(session.id)).toEqual([])
      await client.shell(session.id, "printf 'sdk-smoke'")
      await vi.waitFor(() => expect(types).toContain('session.shell.ended'))
      expect(await client.messages(session.id, { type: 'shell', limit: 1 })).toHaveLength(1)
      await vi.waitFor(async () => expect((await client.resources()).commands.some((command) => command.skillId && command.name === 'sdk-smoke')).toBe(true), { timeout: 5000 })
      const skill = (await client.resources()).commands.find((command) => command.skillId && command.name === 'sdk-smoke')
      const inputId = await client.prompt(session.id, { text: '', skills: [{ id: skill!.skillId! }], delivery: 'steer', resume: false })
      await vi.waitFor(() => expect(enqueued).toContainEqual(expect.objectContaining({ inboxID: inputId,
        item: expect.objectContaining({ type: 'user', delivery: 'steer', payload: expect.objectContaining({ text: '', skills: [expect.objectContaining({ id: skill!.skillId })] }) }),
      })))
      expect(await client.messages(session.id, { type: 'user', limit: 1 })).toEqual([])
      const fork = await client.forkSession(session.id)
      sessions.push(fork.id)
      expect(fork.directory).toBe(directory)
      await client.moveSession(fork.id, directory!)
      await client.interrupt(session.id)
    } finally {
      for (const id of sessions.reverse()) await client.deleteSession(id)
      abort.abort()
      await drained
    }
    expect(types).toContain('server.connected')
  }, 15000)
})
