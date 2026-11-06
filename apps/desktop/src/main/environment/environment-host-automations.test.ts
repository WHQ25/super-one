import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
import { openNodeDatabase } from '@superone/runtime/db'
import { createAutomationStore, ensureAutomationsTable } from '@superone/runtime/automations'
import { createSessionProviderStore } from '@superone/runtime/session'
import { startNodeRuntime } from '../../../../../apps/cli/src/runtime'
import { phoneDomain } from '../node-host/phone-endpoint-test-fixtures'
import { EnvironmentHost } from './environment-host'
import { InProcessRpcClient } from './in-process-rpc-client'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()!() })

describe('automation management through the environment gateway', () => {
  it('resolves a local checkout path and manages the automation on the desktop domain', async () => {
    const db = openNodeDatabase(':memory:')
    cleanup.push(() => db.close())
    ensureAutomationsTable(db)
    const runNow = vi.fn(async () => ({ status: 'completed', sessionId: 'scheduled-session' }))
    let projectPath = ''
    const fixture = phoneDomain(cleanup, { config: {
      sessionProviders: createSessionProviderStore(db),
      automations: { automations: createAutomationStore(db, () => projectPath), automationService: { runNow } },
    } })
    projectPath = fixture.projectDir
    const host = new EnvironmentHost(fixture.userDataDir)
    cleanup.push(() => host.dispose())
    host.registry.getLocal().bindProtocol(new InProcessRpcClient(fixture.domain))
    const { automation } = await host.callAutomation('local', 'automation.create', {
      projectId: fixture.projectDir, name: 'Daily review', prompt: 'Review recent changes',
      agentConfig: { type: 'claude' }, schedule: { type: 'recurring', cron: '0 9 * * *' },
    })
    expect(automation).toMatchObject({ projectId: 'p1', projectPath: fixture.projectDir })
    await host.callAutomation('local', 'automation.update', { projectId: fixture.projectDir, automationId: automation.id, name: 'Renamed' })
    expect(await host.callAutomation('local', 'automation.list', { projectId: fixture.projectDir })).toMatchObject({ automations: [{ id: automation.id, name: 'Renamed' }] })
    expect(await host.callAutomation('local', 'automation.runNow', { projectId: fixture.projectDir, automationId: automation.id })).toMatchObject({ status: 'completed' })
    expect(runNow).toHaveBeenCalledWith(automation.id)
    await host.callAutomation('local', 'automation.delete', { projectId: fixture.projectDir, automationId: automation.id })
    expect(await host.callAutomation('local', 'automation.list', { projectId: fixture.projectDir })).toEqual({ automations: [] })
    await expect(host.callAutomation('missing-node', 'automation.create', { projectId: 'p1', name: 'No fallback', prompt: 'test', agentConfig: { type: 'claude' }, schedule: { type: 'recurring', cron: '0 9 * * *' } })).rejects.toThrow()
  })
  it('stores and runs a remote automation on the selected node, then refuses writes while disconnected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'automation-routing-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const runtime = await startNodeRuntime({ nodeHome: join(dir, 'node'), bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
    cleanup.push(() => runtime.stop())
    const host = new EnvironmentHost(join(dir, 'desktop'))
    cleanup.push(() => host.dispose())
    const { connectionId } = await host.pairRemote({ baseUrl: runtime.server.url, pairingToken: runtime.auth.createPairingToken().token, label: 'Automation node' })
    const project = await host.openProject(connectionId, dir)
    const { automation } = await host.callAutomation(connectionId, 'automation.create', {
      projectId: project.projectId, name: 'Remote review', prompt: 'Review recent changes',
      agentConfig: { type: 'claude' }, schedule: { type: 'recurring', cron: '0 9 * * *' },
    })
    expect(runtime.automations.get(automation.id)).toMatchObject({ name: 'Remote review', projectId: project.projectId })
    expect(await host.callAutomation(connectionId, 'automation.runNow', { automationId: automation.id })).toMatchObject({ status: 'completed' })
    host.disconnect(connectionId)
    await expect(host.callAutomation(connectionId, 'automation.create', {
      projectId: project.projectId, name: 'Must stay remote', prompt: 'test', agentConfig: { type: 'claude' }, schedule: { type: 'recurring', cron: '0 9 * * *' },
    })).rejects.toThrow()
    expect(runtime.automations.listForProject(project.projectId, dir)).toHaveLength(1)
  }, 60_000)

})
