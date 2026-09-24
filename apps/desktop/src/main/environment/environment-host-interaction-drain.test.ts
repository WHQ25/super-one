import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  let userData = ''
  return {
    store,
    get userData() {
      return userData
    },
    setUserData(p: string) {
      userData = p
    },
  }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `h-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: {
    getPath: () => electron.userData || mkdtempSync(join(tmpdir(), 'eh-ud-')),
  },
}))

import type { AgentEvent } from '@superone/shared/agent-types'
import type { TurnRunner } from '@superone/runtime/session'
import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'

const dirs: string[] = []
let runtime: NodeRuntime | null = null
let hostUnderTest: EnvironmentHost | null = null

afterEach(async () => {
  hostUnderTest?.dispose()
  hostUnderTest = null
  resetEnvironmentHostForTests()
  await runtime?.stop().catch(() => {})
  runtime = null
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

const AFTER_QUESTION = 'AFTER_QUESTION_OUTPUT'

/** Asks one question mid-turn, then keeps producing output once it resolves. */
const questionTurnRunner: TurnRunner = async (input) => {
  input.onDelta('before question. ')
  await input.onQuestion!({
    interactionId: `q-${input.messageId}`,
    kind: 'question',
    toolName: 'AskUserQuestion',
    input: { questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }] },
    createdAt: Date.now(),
  })
  input.onDelta(AFTER_QUESTION)
  return { finalText: `before question. ${AFTER_QUESTION}` }
}

describe('EnvironmentHost remote drain across interactions', () => {
  it('keeps streaming a turn whose question resolves without a respond-side drain', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'eh-q-ud-'))
    const nodeHome = mkdtempSync(join(tmpdir(), 'eh-q-node-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'eh-q-proj-'))
    dirs.push(ud, nodeHome, projectDir)
    electron.setUserData(ud)

    runtime = await startNodeRuntime({
      nodeHome,
      bindHost: '127.0.0.1',
      bindPort: 36000 + Math.floor(Math.random() * 1000),
      simulatedHarness: true,
      turnRunner: questionTurnRunner,
    })

    const host = new EnvironmentHost(ud)
    hostUnderTest = host
    const pair = runtime.auth.createPairingToken()
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: runtime.server.url,
      pairingToken: pair.token,
      label: 'question',
    })
    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir)
    const { sessionId } = (await host.createSession(connectionId, {
      projectId: project.projectId,
      harnessId: 'codex',
    })) as { sessionId: string }

    const emitted: AgentEvent[] = []
    host.setAgentEventSink((ev) => emitted.push(ev))

    const sent = host.sendSessionMessage(connectionId, {
      sessionId,
      text: 'ask me first',
      projectPath: `remote:${connectionId}:${projectDir}`,
      providerId: 'codex',
    })

    const question = await vi.waitFor(() => {
      const ev = emitted.find((e) => e.type === 'ask_user_question')
      expect(ev).toBeTruthy()
      return ev as Extract<AgentEvent, { type: 'ask_user_question' }>
    }, { timeout: 10_000, interval: 25 })

    // Resolved without restarting a drain — the same shape as another client
    // answering it, or an older node timing it out.
    await host.respondSessionQuestion(connectionId, {
      sessionId,
      interactionId: question.request.requestId,
      answers: { answers: { 'Proceed?': 'Yes' } },
    })
    await sent
    await vi.waitFor(async () => {
      const snap = (await host.getSession(connectionId, sessionId)) as { status?: string }
      expect(snap.status).toBe('idle')
    }, { timeout: 10_000, interval: 25 })

    const text = emitted
      .flatMap((e) => (e.type === 'content_delta' && e.delta.type === 'text' ? [e.delta.text] : []))
      .join('')
    expect(text).toContain(AFTER_QUESTION)
    expect(emitted.some((e) => e.type === 'message_complete')).toBe(true)
  }, 60_000)
})
