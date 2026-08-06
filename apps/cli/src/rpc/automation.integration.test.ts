/**
 * automation.* RPC + due-scheduler + runNow + automation-owned session metadata.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'auto-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'auto-proj-'))
  dirs.push(nodeHome, projectDir)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: 0,
    simulatedHarness: true,
  })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  const project = (await client.rpc('project.open', {
    path: projectDir,
    name: 'auto-proj',
  })) as { projectId: string; path: string }
  return { rt, client, project, projectDir }
}

describe('automation RPC + scheduler', () => {
  it('CRUD: create list update delete scoped by projectId', async () => {
    const { client, project } = await boot()

    const created = (await client.rpc(
      'automation.create',
      {
        projectId: project.projectId,
        name: 'Daily Review',
        prompt: 'Review recent commits',
        agentConfig: { type: 'claude', permissionMode: 'bypassPermissions', sandboxMode: 'off' },
        schedule: { type: 'recurring', cron: '0 9 * * *', preset: 'daily' },
      },
      crypto.randomUUID(),
    )) as { automation: { id: string; name: string; enabled: boolean; nextRunAt?: string } }

    expect(created.automation.id).toBeTruthy()
    expect(created.automation.name).toBe('Daily Review')
    expect(created.automation.enabled).toBe(true)
    expect(created.automation.nextRunAt).toBeTruthy()

    const listed = (await client.rpc('automation.list', { projectId: project.projectId })) as {
      automations: Array<{ id: string }>
    }
    expect(listed.automations.map((a) => a.id)).toContain(created.automation.id)

    const updated = (await client.rpc(
      'automation.update',
      {
        automationId: created.automation.id,
        projectId: project.projectId,
        name: 'Renamed',
        enabled: false,
      },
      crypto.randomUUID(),
    )) as { automation: { name: string; enabled: boolean } }
    expect(updated.automation.name).toBe('Renamed')
    expect(updated.automation.enabled).toBe(false)

    const del = (await client.rpc(
      'automation.delete',
      { automationId: created.automation.id, projectId: project.projectId },
      crypto.randomUUID(),
    )) as { ok: true }
    expect(del.ok).toBe(true)

    const after = (await client.rpc('automation.list', { projectId: project.projectId })) as {
      automations: Array<{ id: string }>
    }
    expect(after.automations.find((a) => a.id === created.automation.id)).toBeUndefined()
  })

  it('mutating methods require idempotencyKey', async () => {
    const { client, project } = await boot()
    // Empty key is falsy — handler rejects before mutate (ws helper would otherwise auto-fill).
    await expect(
      client.rpc(
        'automation.create',
        {
          projectId: project.projectId,
          name: 'x',
          prompt: 'y',
          agentConfig: { type: 'claude' },
          schedule: { type: 'one-time', runAt: new Date().toISOString() },
        },
        '',
      ),
    ).rejects.toThrow(/idempotency/i)
  })

  it('runNow spawns automation-owned session turn (simulated harness)', async () => {
    const { client, project, rt } = await boot()

    const created = (await client.rpc(
      'automation.create',
      {
        projectId: project.projectId,
        name: 'Now Job',
        prompt: 'Say hello from automation',
        agentConfig: { type: 'codex', permissionPreset: 'full-access' },
        // Far-future so scheduler does not double-fire during the test.
        schedule: { type: 'one-time', runAt: '2099-01-01T00:00:00.000Z' },
      },
      crypto.randomUUID(),
    )) as { automation: { id: string } }

    const run = (await client.rpc(
      'automation.runNow',
      { automationId: created.automation.id, projectId: project.projectId },
      crypto.randomUUID(),
    )) as { automationId: string; status: string; sessionId?: string }

    expect(run.automationId).toBe(created.automation.id)
    expect(run.status).toBe('completed')
    expect(run.sessionId).toBeTruthy()

    const sessions = (await client.rpc('session.list', { projectId: project.projectId })) as Array<{
      sessionId: string
      isAutomation?: boolean
      automationId?: string | null
      title?: string | null
    }>
    const autoSession = sessions.find((s) => s.sessionId === run.sessionId)
    expect(autoSession).toBeTruthy()
    expect(autoSession!.isAutomation).toBe(true)
    expect(autoSession!.automationId).toBe(created.automation.id)
    expect(autoSession!.title).toContain('[Auto]')

    // Direct store metadata also filterable.
    const listed = rt.sessions.list(project.projectId).filter((s) => s.isAutomation)
    expect(listed.some((s) => s.automationId === created.automation.id)).toBe(true)

    // One-time schedule disabled after successful run.
    const after = (await client.rpc('automation.list', { projectId: project.projectId })) as {
      automations: Array<{ id: string; enabled: boolean; lastRunStatus?: string }>
    }
    const row = after.automations.find((a) => a.id === created.automation.id)
    expect(row?.enabled).toBe(false)
    expect(row?.lastRunStatus).toBe('completed')
  })

  it('due row fires session turn without client-driven runNow', async () => {
    const { client, project, rt } = await boot()

    const past = new Date(Date.now() - 60_000).toISOString()
    const created = (await client.rpc(
      'automation.create',
      {
        projectId: project.projectId,
        name: 'Due Job',
        prompt: 'Scheduled prompt',
        agentConfig: { type: 'claude', permissionMode: 'bypassPermissions' },
        schedule: { type: 'one-time', runAt: past },
      },
      crypto.randomUUID(),
    )) as { automation: { id: string } }

    // Scheduler poll is 200ms under simulatedHarness; wait for completion.
    const deadline = Date.now() + 10_000
    let lastStatus: string | undefined
    while (Date.now() < deadline) {
      const listed = (await client.rpc('automation.list', { projectId: project.projectId })) as {
        automations: Array<{ id: string; lastRunStatus?: string; lastRunSessionId?: string }>
      }
      const row = listed.automations.find((a) => a.id === created.automation.id)
      lastStatus = row?.lastRunStatus
      if (row?.lastRunStatus === 'completed' && row.lastRunSessionId) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(lastStatus).toBe('completed')

    const autoSessions = rt.sessions.list(project.projectId).filter((s) => s.isAutomation === true)
    expect(autoSessions.length).toBeGreaterThanOrEqual(1)
    expect(autoSessions.some((s) => s.automationId === created.automation.id)).toBe(true)
  })
})
