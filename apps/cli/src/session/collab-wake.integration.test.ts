/**
 * Collaboration mailbox peer wake + agents confirm (node SessionRuntime).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime } from './session-runtime'
import { HarnessManager } from './harness-manager'
import { ProviderStore } from '../provider/provider-store'
import { ProjectRegistry } from '../workspace/project-registry'
import { WorkspaceGitService } from '../workspace/git-service'
import { CollaborationService } from './collaboration'
import { redactTaskNotificationForDisplay } from '@superone/runtime/session'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'collab-wake-'))
  dirs.push(nodeHome)
  const db = openNodeDatabase(join(nodeHome, 'state.sqlite'))
  const environmentId = 'env-wake'
  const events = new EventLog(db, environmentId)
  const leases = new ControlLeaseService(db)
  const turns: Array<{ sessionId: string; text: string }> = []
  const sessions = new SessionRuntime(
    db,
    events,
    leases,
    environmentId,
    async ({ session, text, onDelta }) => {
      turns.push({ sessionId: session.sessionId, text })
      onDelta('ok')
      return { finalText: 'ok' }
    },
  )
  const harnesses = new HarnessManager(db)
  const providers = new ProviderStore(db, join(nodeHome, 'secrets', 'provider.key'))
  const projects = new ProjectRegistry(db)
  const workspaceGit = new WorkspaceGitService(projects)
  const secrets = {
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => (v.startsWith('enc:') ? v.slice(4) : v),
  }
  const collab = new CollaborationService({
    db,
    events,
    environmentId,
    sessions,
    harnesses,
    providers,
    projects,
    workspaceGit,
    secrets,
  })
  return { sessions, collab, projects, turns, leases, environmentId }
}

describe('collab wake + agents confirm', () => {
  it('redactTaskNotificationForDisplay strips s1sc credentials', () => {
    const secret = 's1sc_abcdefghijklmnopqrstuvwxyz0123456789'
    const full = `A collaboration mailbox message is ready. Call session_collab_retrieve with credential ${JSON.stringify(secret)} to receive it.`
    const redacted = redactTaskNotificationForDisplay(full)
    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain('s1sc_')
    expect(redacted).toMatch(/session_collab_retrieve/i)
  })

  it('mailbox send wakes peer with task-notification; transcript redacts credential', async () => {
    const { collab, sessions, projects, turns } = boot()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-wake-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'parent',
    })
    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          task: 'work',
          name: 'W',
          role: 'R',
          config: { cwd: projectDir },
        },
      ],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const { credential } = req.launches[0]
    const started = await collab.start({ credential })
    turns.length = 0

    collab.send({
      credential,
      sessionId: parent.sessionId,
      content: '## hello peer',
    })

    // Best-effort wake is async; wait for turn runner.
    for (let i = 0; i < 50; i++) {
      if (turns.some((t) => t.sessionId === started.sessionId)) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const wake = turns.find((t) => t.sessionId === started.sessionId)
    expect(wake).toBeTruthy()
    expect(wake!.text).toContain(credential)
    expect(wake!.text).toMatch(/session_collab_retrieve/)

    // Transcript must not leak the credential.
    for (let i = 0; i < 50; i++) {
      const child = sessions.get(started.sessionId)
      if (child?.transcript.some((b) => b.role === 'user')) break
      await new Promise((r) => setTimeout(r, 20))
    }
    const child = sessions.get(started.sessionId)!
    const userText = child.transcript.filter((b) => b.role === 'user').map((b) => b.text).join('\n')
    expect(userText).not.toContain(credential)
    expect(userText).not.toMatch(/\bs1sc_/)
  })

  it('requireUserConfirm emits session_agents_confirm; accept creates grants', async () => {
    const { collab, sessions, projects, leases, environmentId } = boot()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-confirm-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'parent',
      controllerClientSessionId: 'client-1',
    })
    const lease = leases.acquire({
      resource: { environmentId, sessionId: parent.sessionId },
      holderClientId: 'client-1',
      ttlMs: 60_000,
    })

    const pendingPromise = collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          task: 'review',
          name: 'Rev',
          role: 'Reviewer',
          config: { cwd: projectDir },
        },
      ],
      requireUserConfirm: true,
    })

    let interactionId = ''
    for (let i = 0; i < 50; i++) {
      const s = sessions.get(parent.sessionId)
      if (s?.pendingInteraction?.kind === 'session_agents_confirm') {
        interactionId = s.pendingInteraction.interactionId
        expect(s.pendingInteraction.sessionAgentsConfirm?.launches).toHaveLength(1)
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(interactionId).toBeTruthy()

    sessions.respondPermission({
      sessionId: parent.sessionId,
      interactionId,
      decision: 'allow',
      client: { clientSessionId: 'client-1' },
      leaseId: lease.leaseId,
      generation: lease.generation,
    })

    const result = await pendingPromise
    expect(result.status).toBe('approved')
    if (result.status !== 'approved') throw new Error('expected approved')
    expect(result.launches).toHaveLength(1)
    expect(result.launches[0].credential.startsWith('s1sc_')).toBe(true)
    expect(sessions.get(parent.sessionId)?.pendingInteraction).toBeNull()
  })
})
