import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_ENVIRONMENT_CAPABILITIES, PROTOCOL_GENERATION } from '@superone/shared/environment'
import { EnvironmentRegistryImpl } from './environment-registry'
import { LocalEnvironmentGateway } from './local-environment-gateway'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-local-gw-'))
  dirs.push(dir)
  return dir
}

describe('LocalEnvironmentGateway', () => {
  it('returns a stable descriptor with local capabilities', async () => {
    const dataDir = tempDir()
    const gw = new LocalEnvironmentGateway({
      dataDir,
      label: 'Test Mac',
      nodeVersion: 'v22.0.0',
      listProjects: () => [
        { projectId: 'p1', path: '/tmp/demo', name: 'demo' },
      ],
    })

    const d1 = await gw.getDescriptor()
    const d2 = await gw.getDescriptor()
    expect(d1.environmentId).toBe(d2.environmentId)
    expect(d1.label).toBe('Test Mac')
    expect(d1.nodeVersion).toBe('v22.0.0')
    expect(d1.protocolVersion).toBe(PROTOCOL_GENERATION.current)
    expect(d1.capabilities.sessions).toBe(LOCAL_ENVIRONMENT_CAPABILITIES.sessions)
    expect(d1.capabilities.harnessIds).toEqual(LOCAL_ENVIRONMENT_CAPABILITIES.harnessIds)
    expect(d1.generations?.protocol.current).toBe(PROTOCOL_GENERATION.current)

    const projects = await gw.listProjects()
    expect(projects).toEqual([{ projectId: 'p1', path: '/tmp/demo', name: 'demo' }])

    const snapshot = await gw.getSnapshot()
    expect(snapshot.environmentId).toBe(d1.environmentId)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.snapshotSequence).toBe('0')
  })

  it('keeps session create unwired until Environment API migration covers it', async () => {
    const gw = new LocalEnvironmentGateway({ dataDir: tempDir() })
    await expect(
      gw.sessions.create({
        project: { environmentId: gw.getEnvironmentId(), projectId: 'p' },
        providerId: 'claude',
      }),
    ).rejects.toThrow(/not wired yet/)
    await expect(
      gw.sessions.list(
        { environmentId: gw.getEnvironmentId(), projectId: 'p' },
        { limit: 30, offset: 0 },
      ),
    ).rejects.toThrow(/not wired yet/)
  })

  it('lists sessions through the injected port with limit/offset', async () => {
    const listed: unknown[] = []
    const gw = new LocalEnvironmentGateway({
      dataDir: tempDir(),
      sessions: {
        create: () => ({ sessionId: 'x' }),
        get: () => null,
        list: (projectId, options) => {
          listed.push({ projectId, options })
          return [{ sessionId: 's1', title: 't' }]
        },
        send: async () => ({}),
        acquireControl: () => ({
          leaseId: 'l',
          generation: 'g',
          holderClientId: 'c',
          expiresAt: new Date().toISOString(),
        }),
      },
    })
    const rows = await gw.sessions.list(
      { environmentId: gw.getEnvironmentId(), projectId: 'proj-1' },
      { limit: 10, offset: 5 },
    )
    expect(rows).toEqual([{ sessionId: 's1', title: 't' }])
    expect(listed).toEqual([{ projectId: 'proj-1', options: { limit: 10, offset: 5 } }])
  })

  it('subscribeEvents completes without yielding when no local event log exists', async () => {
    const gw = new LocalEnvironmentGateway({ dataDir: tempDir() })
    const events: unknown[] = []
    for await (const e of gw.subscribeEvents({ environmentId: gw.getEnvironmentId() })) {
      events.push(e)
    }
    expect(events).toEqual([])
  })
})

describe('EnvironmentRegistryImpl', () => {
  it('lists the local environment and resolves by id', async () => {
    const registry = new EnvironmentRegistryImpl({ dataDir: tempDir(), label: 'Local' })
    const local = registry.getLocal()
    const id = local.getEnvironmentId()
    expect(registry.get(id)).toBe(local)
    expect(registry.get('missing')).toBeNull()

    const list = await registry.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.environmentId).toBe(id)
    expect(list[0]?.label).toBe('Local')
  })
})
