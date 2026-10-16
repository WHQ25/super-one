import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SESSION_DURABLE_EVENT, type ControlLease } from '@superone/shared/environment'
import { findSuggestedTask, type SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

vi.mock('../session/claude-model-catalog', () => ({ getNodeClaudeModelCatalog: vi.fn(async () => [{ id: 'opus', name: 'Opus', supportsFastMode: true }]) }))

const runtimes: NodeRuntime[] = [], dirs: string[] = [], clients: Client[] = []
const worktrees: Array<{ root: string; path: string }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (clients.length) await clients.pop()!.close().catch(() => {})
  while (runtimes.length) await runtimes.pop()!.stop().catch(() => {})
  for (const { root, path } of worktrees.splice(0)) { if (!existsSync(path)) continue; try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', path]) } catch {} }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const folder = () => { const dir = mkdtempSync(join(tmpdir(), 'suggested-task-node-')); dirs.push(dir); return dir }
const INPUT = { title: 'Fix node-local issue', tldr: 'A separate issue on this node.', prompt: 'Fix the issue in this execution environment.' }

async function boot(git = false) {
  const nodeHome = folder(), root = folder()
  if (git) {
    execFileSync('git', ['init', '-q', root])
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'init'])
  }
  const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true }); runtimes.push(rt)
  const rpc = await connectAuthedRpc(rt)
  const { projectId } = await rpc.rpc('project.open', { path: root }) as { projectId: string }
  const { sessionId } = await rpc.rpc('session.create', { projectId, harnessId: 'claude', providerId: 'claude-base' }) as { sessionId: string }
  const cfg = rt.hostActionMcp!.getHttpConfig(sessionId)
  const client = new Client({ name: 'suggest-test', version: '1' }); clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }))
  return { rt, rpc, client, sessionId, projectId, nodeHome, root }
}

function card(rt: NodeRuntime, sessionId: string, taskId: string) {
  rt.events.appendSession({ sessionId, eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event: { type: 'transcript_replaced', messages: [{
    id: 'suggestion', role: 'assistant', status: 'complete', providerId: 'claude', createdAt: '', content: [
      { type: 'tool_use', toolName: 'mcp__superone__session_suggest_task', toolUseId: 'suggest', input: JSON.stringify(INPUT), status: 'complete' },
      { type: 'tool_result', toolUseId: 'suggest', summary: JSON.stringify({ taskId, status: 'pending' }) },
    ],
  }] } } })
}

describe('suggested tasks stay on their source execution environment', () => {
  it('serves the node-local MCP tool, configures a launch through RPC, and persists its outcome', async () => {
    const { rt, rpc, client, sessionId, nodeHome } = await boot()
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('session_suggest_task')
    const result = await client.callTool({ name: 'session_suggest_task', arguments: INPUT })
    expect(result.isError).not.toBe(true)
    const { taskId } = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    card(rt, sessionId, taskId)
    const options = await rpc.rpc('session.suggestedTaskLaunchOptions', { sessionId, taskId }) as SuggestedTaskLaunchOptions
    expect(options.initial.agentId).toBe('claude-base')
    expect(options.profiles.find(profile => profile.harnessId === 'claude')?.models).toContainEqual(expect.objectContaining({ id: 'opus', supportsFastMode: true }))
    rt.sessions.patchSettings(sessionId, { claudeFastMode: true })
    expect(await rpc.rpc('session.load', { sessionId })).toMatchObject({ state: { claudeFastMode: true } })
    expect(rt.sessions.list()).toHaveLength(1)
    await expect(rpc.rpc('session.launchSuggestedTask', { sessionId, taskId })).rejects.toThrow()
    const lease = await rpc.rpc('session.acquireControl', { sessionId }) as ControlLease
    const profile = options.profiles.find(profile => profile.harnessId === 'codex')!
    const choice = { agentId: profile.id, settings: { model: profile.models[0].id, permissionMode: 'bypassPermissions' } }
    const input = { sessionId, taskId, leaseId: lease.leaseId, generation: lease.generation, choice, prompt: 'FORGED', environmentId: 'another-host' }
    const launched = await rpc.rpc('session.launchSuggestedTask', input, 'launch-once') as { sessionId: string }
    expect(await rpc.rpc('session.launchSuggestedTask', input, 'launch-once')).toEqual(launched)
    expect(rt.sessions.list()).toHaveLength(2)
    expect(rt.sessions.get(launched.sessionId)).toMatchObject({ harnessId: 'codex', model: choice.settings.model, permissionMode: 'bypassPermissions', title: INPUT.title })
    expect(JSON.stringify(rt.sessions.messages(launched.sessionId))).toContain(INPUT.prompt)
    expect(JSON.stringify(rt.sessions.messages(launched.sessionId))).not.toContain('FORGED')
    expect(findSuggestedTask(rt.sessions.messages(sessionId), taskId)?.state).toEqual({ status: 'launched', sessionId: launched.sessionId })
    await expect(rpc.rpc('session.launchSuggestedTask', input)).rejects.toThrow(/already launched/)
    await client.close(); clients.pop()
    await rt.stop(); runtimes.pop()
    const restored = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true }); runtimes.push(restored)
    expect(restored.sessions.get(sessionId)?.claudeFastMode).toBe(true)
    expect(findSuggestedTask(restored.sessions.messages(sessionId), taskId)?.state).toEqual({ status: 'launched', sessionId: launched.sessionId })
  })

  it('creates the node task worktree from the source checkout HEAD and fences a stale proof', async () => {
    const { rt, rpc, sessionId, root, projectId } = await boot(true)
    const sourceWorktree = folder()
    execFileSync('git', ['-C', root, 'worktree', 'add', '-qb', 'source-branch', sourceWorktree])
    worktrees.push({ root, path: sourceWorktree })
    execFileSync('git', ['-C', sourceWorktree, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'source'])
    rt.sessions.setCwd(sessionId, sourceWorktree)
    const sourceHead = execFileSync('git', ['-C', sourceWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    expect(sourceHead).not.toBe(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
    const { taskId } = rt.collaboration.suggestTask(sessionId, INPUT)
    card(rt, sessionId, taskId)
    const lease = await rpc.rpc('session.acquireControl', { sessionId }) as ControlLease
    const proof = { sessionId, taskId, leaseId: lease.leaseId, generation: lease.generation }
    const launched = await rpc.rpc('session.launchSuggestedTask', proof) as { sessionId: string }
    const child = rt.sessions.get(launched.sessionId)!
    expect(child.projectId).toBe(projectId)
    worktrees.push({ root, path: child.cwd! })
    expect(child.cwd).not.toBe(sourceWorktree)
    expect(execFileSync('git', ['-C', child.cwd!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(sourceHead)
    const resource = { environmentId: rt.identity.environmentId, sessionId }
    rt.leases.revoke(resource)
    await expect(rpc.rpc('session.launchSuggestedTask', proof)).rejects.toMatchObject({ code: 'lease_stale' })
  })

  it('rejects a card from another source session and rechecks control after async preparation', async () => {
    const { rt, rpc, sessionId, projectId } = await boot()
    const { taskId } = rt.collaboration.suggestTask(sessionId, INPUT)
    card(rt, sessionId, taskId)
    const other = await rpc.rpc('session.create', { projectId, harnessId: 'claude' }) as { sessionId: string }
    await expect(rpc.rpc('session.suggestedTaskLaunchOptions', { sessionId: other.sessionId, taskId })).rejects.toMatchObject({ code: 'not_found' })
    const lease = await rpc.rpc('session.acquireControl', { sessionId }) as ControlLease
    const original = rt.workspaceGit.isAllowedSessionCwd.bind(rt.workspaceGit)
    vi.spyOn(rt.workspaceGit, 'isAllowedSessionCwd').mockImplementationOnce(async (...args) => {
      const allowed = await original(...args)
      rt.leases.revoke({ environmentId: rt.identity.environmentId, sessionId })
      return allowed
    })
    await expect(rpc.rpc('session.launchSuggestedTask', { sessionId, taskId, leaseId: lease.leaseId, generation: lease.generation })).rejects.toMatchObject({ code: 'lease_stale' })
    expect(rt.sessions.list()).toHaveLength(2)
    expect(findSuggestedTask(rt.sessions.messages(sessionId), taskId)?.state).toBeUndefined()
  })

  it('cleans a worktree and its branch after lease loss so the same card can retry', async () => {
    const { rt, rpc, sessionId, root } = await boot(true)
    const { taskId } = rt.collaboration.suggestTask(sessionId, INPUT)
    card(rt, sessionId, taskId)
    const lease = await rpc.rpc('session.acquireControl', { sessionId }) as ControlLease
    const original = rt.workspaceGit.activateWorktree.bind(rt.workspaceGit)
    vi.spyOn(rt.workspaceGit, 'activateWorktree').mockImplementationOnce(async (...args) => {
      const created = await original(...args)
      worktrees.push({ root, path: created.path })
      rt.leases.revoke({ environmentId: rt.identity.environmentId, sessionId })
      return created
    })
    await expect(rpc.rpc('session.launchSuggestedTask', { sessionId, taskId, leaseId: lease.leaseId, generation: lease.generation })).rejects.toMatchObject({ code: 'lease_stale' })
    expect(existsSync(worktrees[0]!.path)).toBe(false)
    expect(findSuggestedTask(rt.sessions.messages(sessionId), taskId)?.state).toBeUndefined()
    const retryLease = await rpc.rpc('session.acquireControl', { sessionId }) as ControlLease
    const launched = await rpc.rpc('session.launchSuggestedTask', { sessionId, taskId, leaseId: retryLease.leaseId, generation: retryLease.generation, choice: { agentId: 'claude-base', settings: { model: 'claude-sonnet-5-5', fastMode: false } } }) as { sessionId: string }
    worktrees.push({ root, path: rt.sessions.get(launched.sessionId)!.cwd! })
    expect(findSuggestedTask(rt.sessions.messages(sessionId), taskId)?.state?.status).toBe('launched')
  })

  it('keeps suggestions restricted to the main session on a node', async () => {
    const { rt, sessionId } = await boot()
    const request = await rt.collaboration.request({ parentSessionId: sessionId, launches: [{ launchId: 'spawn', mode: 'spawn', agentId: 'claude-base', name: 'Child', role: 'Reviewer', summary: 'Review' }] })
    if (request.status !== 'approved') throw new Error('Expected approved')
    const child = await rt.collaboration.start({ callerSessionId: sessionId, launchId: request.launches[0].launchId, task: 'Review the code' })
    expect(() => rt.collaboration.suggestTask(child.sessionId, INPUT)).toThrow(/main session/)
    expect(() => rt.collaboration.suggestTask(sessionId, { ...INPUT, cwd: 'relative' })).toThrow(/absolute directory/)
  })
})
