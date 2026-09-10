/**
 * Integration: CursorBackend host interactions → real Session → MobileBroadcaster.
 *
 * Only the Cursor runtime factory (the SDK boundary) is faked. The fake runtime
 * plays the two roles the real one has: a `superone_ask_user_question` custom
 * tool call that blocks until the host answers, and a `createPlan` completion
 * that raises a plan approval once the run settles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AskUserQuestionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import type { CursorRuntimeInteractions } from '@superone/cursor'
import type { Session as SessionType, SessionManager } from '../types'

const { factoryMock, prewarmMock } = vi.hoisted(() => ({
  factoryMock: vi.fn(),
  prewarmMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../cursor/cursor-runtime', () => ({
  getCursorRuntimeFactory: () => factoryMock,
  setCursorRuntimeFactory: vi.fn(),
  prewarmCursorWorkspace: (...args: unknown[]) => prewarmMock(...args),
}))

// Real ladder mapping (plan ↔ agent must differ for the post-approval rebuild).
vi.mock('../../cursor/cursor-auth', async () => {
  const cursor = await import('@superone/cursor')
  return { mapPermissionToCursorLocal: cursor.mapPermissionToCursorLocal }
})

vi.mock('../../database', () => ({
  getCachedHarnessResources: () => null,
}))

vi.mock('@superone/cursor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superone/cursor')>()
  return { ...actual, buildCursorModelSelection: () => undefined }
})

vi.mock('../../sandbox-platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sandbox-platform')>()),
  getSandboxCapability: () => ({ supportLevel: 'always', platform: 'darwin', defaultMode: 'on' }),
}))
vi.mock('../../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../../mcp/config-tools', () => ({ resolveConfigConfirm: () => false, rejectConfigConfirm: () => false }))
vi.mock('../../mcp/media-tools', () => ({ resolveVideoConfirm: () => false, rejectVideoConfirm: () => false }))
vi.mock('../../mcp/miniapp-call-confirm', () => ({ resolveMiniappCallConfirm: () => false, rejectMiniappCallConfirm: () => false }))
vi.mock('../../mcp/browser-webmcp-confirm', () => ({ resolveWebmcpTrustConfirm: () => false, rejectWebmcpTrustConfirm: () => false }))
vi.mock('../session-collaboration-confirm', () => ({ resolveSessionAgentsConfirm: () => false, rejectSessionAgentsConfirm: () => false }))
vi.mock('../../acp/acp-recap-focus', () => ({
  notifySessionRecapForeground: vi.fn(),
  notifySessionRecapSessionRemoved: vi.fn(),
  notifySessionRecapReceived: vi.fn(),
}))

import { MobileBroadcaster, type MobileTransport } from '../../remote/mobile-broadcaster'
import { Session } from '../session'
import { CursorBackend } from './cursor-backend'

const QUESTION: AskUserQuestionRequest = {
  requestId: 'call-q1',
  questions: [{
    question: 'Which database?',
    header: 'Database',
    options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }],
    multiSelect: false,
  }],
}

const PLAN: PlanApprovalRequest = { requestId: 'call-plan', planContent: '# The plan', planFilePath: '', allowedPrompts: [] }

interface FakeRuntime {
  interactions: CursorRuntimeInteractions
  /** Mode the backend built this runtime with. */
  permissionMode: string
  sends: { messageId: string; content: string }[]
  /** Per-send behavior; default is an immediate empty turn. */
  onSend: (messageId: string, content: string) => Promise<void>
  cancel: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function installRuntimeFactory(configure?: (runtime: FakeRuntime, index: number) => void): FakeRuntime[] {
  const runtimes: FakeRuntime[] = []
  factoryMock.mockImplementation(async (opts: { interactions: CursorRuntimeInteractions; permissionMode: string }) => {
    const runtime: FakeRuntime = {
      interactions: opts.interactions,
      permissionMode: opts.permissionMode,
      sends: [],
      onSend: async () => undefined,
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    configure?.(runtime, runtimes.length)
    runtimes.push(runtime)
    return {
      agentId: 'a1',
      isCloud: false,
      lastRunId: null,
      send: async (messageId: string, content: string) => {
        runtime.sends.push({ messageId, content })
        await runtime.onSend(messageId, content)
        // Mirrors the real runtime's post-run cleanup.
        runtime.interactions.cancelQuestions('turn ended')
        return {}
      },
      cancel: runtime.cancel,
      close: runtime.close,
      setModel: vi.fn(),
      setPermissionMode: vi.fn(),
      reload: vi.fn(),
      getMcpServerStatus: vi.fn().mockResolvedValue([]),
      listArtifacts: vi.fn(),
      downloadArtifact: vi.fn(),
    }
  })
  return runtimes
}

function makeTransport(): MobileTransport & { sent: AgentEvent[] } {
  const sent: AgentEvent[] = []
  return { sent, async sendAgentEvent(event) { sent.push(event) } }
}

function makeSession(permissionMode: 'agent' | 'plan' = 'agent') {
  const backend = new CursorBackend()
  const session = new Session({
    id: 'cursor-1',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    providerId: 'cursor',
    harnessId: 'cursor',
    providerConfig: { apiKey: 'cursor_test_key' },
    backend,
    permissionMode,
  })
  const transport = makeTransport()
  const manager = { getSession: (id: string) => (id === session.id ? session : null) } as unknown as SessionManager
  const broadcaster = new MobileBroadcaster(manager, transport)
  // AgentService wiring: every session event reaches the mobile broadcaster,
  // whether or not a phone has this session open.
  const events: AgentEvent[] = []
  session.on((event) => {
    events.push(event)
    void broadcaster.broadcast(event)
  })
  return { session: session as unknown as SessionType & Session, backend, transport, events }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function activities(sent: AgentEvent[]) {
  return sent.flatMap((event) => (event.type === 'session_activity' ? [event.activity] : []))
}

describe('CursorBackend host interactions through Session + MobileBroadcaster', () => {
  beforeEach(() => {
    factoryMock.mockReset()
    prewarmMock.mockReset().mockResolvedValue(undefined)
  })

  it('question: arrival → pending registry → mobile summary → answer → cleared', async () => {
    let answer: unknown = null
    installRuntimeFactory((runtime) => {
      // The SDK invokes the custom question tool mid-run and blocks on its result.
      runtime.onSend = async () => { answer = await runtime.interactions.askQuestion(QUESTION) }
    })
    const { session, transport, events } = makeSession()
    const sendDone = session.send({ content: 'set up a database', assistantMessageId: 'a1' })
    await tick()
    await tick()

    // Register-before-emit: the summary built inside the broadcast already counts it.
    const pendingActivity = activities(transport.sent).at(-1)
    expect(pendingActivity).toMatchObject({ sessionId: 'cursor-1', provider: 'cursor', pendingCount: 1 })
    expect(pendingActivity?.pendingReason.en).toBeTruthy()
    // Restore path (desktop switch / mobile open) sees the same request.
    expect(session.getPendingInteractions()).toEqual([
      expect.objectContaining({ type: 'ask_user_question', sessionId: 'cursor-1', request: QUESTION }),
    ])
    expect(events.some((e) => e.type === 'ask_user_question' && e.request.requestId === 'call-q1')).toBe(true)

    session.respondToQuestion('call-q1', { Database: 'Postgres' })
    await sendDone
    expect(answer).toEqual({ kind: 'answered', answers: { Database: 'Postgres' }, annotations: undefined })
    expect(session.getPendingInteractions()).toEqual([])
    expect(events.some((e) => e.type === 'interaction_resolved' && e.interactionType === 'question' && e.requestId === 'call-q1')).toBe(true)
    const cleared = activities(transport.sent).find((a, i, all) => i > all.findIndex((x) => x.pendingCount === 1) && a.pendingCount === 0)
    expect(cleared).toMatchObject({ pendingCount: 0, pendingReason: { en: null, zh: null } })
  })

  it('question: dismissal resolves without an answer; interrupt releases a hanging question', async () => {
    const runtimes = installRuntimeFactory()
    const { session, events } = makeSession()
    const sendDone = session.send({ content: 'go', assistantMessageId: 'a1' })
    await tick()
    const runtime = runtimes[0]!

    const dismissed = runtime.interactions.askQuestion({ ...QUESTION, requestId: 'q-dismiss' })
    session.dismissQuestion('q-dismiss')
    await expect(dismissed).resolves.toEqual({ kind: 'dismissed' })
    await sendDone

    // Second turn: the question is still open when the user hits Stop.
    let release: (() => void) | null = null
    runtime.onSend = () => new Promise<void>((resolve) => { release = resolve })
    const second = session.send({ content: 'again', assistantMessageId: 'a2' })
    await tick()
    const hanging = runtime.interactions.askQuestion({ ...QUESTION, requestId: 'q-hang' })
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(1)
    await session.interrupt()
    await expect(hanging).resolves.toEqual({ kind: 'cancelled', reason: 'interrupted' })
    expect(session.getPendingInteractions()).toEqual([])
    expect(events.filter((e) => e.type === 'interaction_resolved').map((e) => e.requestId)).toEqual(['q-dismiss', 'q-hang'])
    release?.()
    await second
  })

  it('plan: approval leaves plan mode and carries the decision back as a host follow-up turn', async () => {
    const runtimes = installRuntimeFactory((runtime, index) => {
      // First runtime (plan mode): the run ends with a completed createPlan.
      // The real runtime raises this after run.wait() settles and does not await it.
      if (index === 0) runtime.onSend = async () => { void runtime.interactions.requestPlanApproval(PLAN) }
    })
    const { session, transport, events } = makeSession('plan')

    await session.send({ content: 'plan the migration', assistantMessageId: 'a1' })
    await tick()

    expect(session.getPendingInteractions()).toEqual([
      expect.objectContaining({ type: 'plan_approval', request: PLAN }),
    ])
    expect(activities(transport.sent).at(-1)).toMatchObject({ pendingCount: 1 })
    expect(runtimes[0]!.permissionMode).toBe('plan')

    session.respondToPlanApproval('call-plan', true)
    // A double-click / second device answering the same plan is a no-op.
    session.respondToPlanApproval('call-plan', true)
    // Decision → turn settled → mode switch (rebuild) → follow-up host turn.
    for (let i = 0; i < 10; i++) await tick()

    expect(session.getPendingInteractions()).toEqual([])
    expect(events.some((e) => e.type === 'interaction_resolved' && e.interactionType === 'plan_approval' && e.approved === true)).toBe(true)
    // Session learned the switch from the backend (onPermissionModeApplied) and
    // the follow-up turn ran on a runtime rebuilt in agent mode.
    expect(events.some((e) => e.type === 'permission_mode_change' && e.mode === 'agent')).toBe(true)
    expect(runtimes).toHaveLength(2)
    expect(runtimes[1]!.permissionMode).toBe('agent')
    // Exactly one implementation turn, and it only starts because of the approval.
    expect(runtimes[1]!.sends).toHaveLength(1)
    expect(runtimes[0]!.sends).toHaveLength(1)
    const followUp = runtimes[1]!.sends[0]
    expect(followUp?.content).toMatch(/approved the plan/i)
    expect(events.filter((e) => e.type === 'interaction_resolved' && e.interactionType === 'plan_approval')).toHaveLength(1)
    expect(activities(transport.sent).at(-1)).toMatchObject({ pendingCount: 0 })
  })

  it('plan: rejection with feedback stays in plan mode and sends the feedback; a new user turn cancels a stale plan', async () => {
    const runtimes = installRuntimeFactory()
    const { session, events } = makeSession('plan')
    await session.send({ content: 'plan it', assistantMessageId: 'a1' })
    const runtime = runtimes[0]!
    void runtime.interactions.requestPlanApproval(PLAN)
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(1)

    session.respondToPlanApproval('call-plan', false, 'too risky')
    for (let i = 0; i < 6; i++) await tick()
    expect(events.some((e) => e.type === 'permission_mode_change')).toBe(false)
    expect(runtimes).toHaveLength(1)
    expect(runtime.sends.at(-1)?.content).toMatch(/rejected the plan.*too risky/s)

    // A plan nobody acted on is mooted by the next user message.
    void runtime.interactions.requestPlanApproval({ ...PLAN, requestId: 'call-plan-2' })
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(1)
    await session.send({ content: 'forget the plan, just do X', assistantMessageId: 'a3' })
    expect(session.getPendingInteractions()).toEqual([])
    expect(events.some((e) => e.type === 'interaction_resolved' && e.requestId === 'call-plan-2' && e.approved === false)).toBe(true)
  })

  it('interrupt: voids the pending plan and refuses a plan the interrupted run raises late', async () => {
    const runtimes = installRuntimeFactory()
    const { session, events } = makeSession('plan')
    let release: (() => void) | null = null
    let planPromise: Promise<unknown> | null = null
    const sendDone = session.send({ content: 'plan it', assistantMessageId: 'a1' })
    await tick()
    const runtime = runtimes[0]!
    runtime.onSend = () => new Promise<void>((resolve) => { release = resolve })
    const second = (async () => { await sendDone; return session.send({ content: 'plan more', assistantMessageId: 'a2' }) })()
    await tick()
    await tick()
    planPromise = runtime.interactions.requestPlanApproval(PLAN)
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(1)

    // Stop: the plan of the stopped turn is not something to act on later.
    await session.interrupt()
    await expect(planPromise).resolves.toEqual({ kind: 'cancelled', reason: 'interrupted' })
    expect(session.getPendingInteractions()).toEqual([])
    expect(events.some((e) => e.type === 'interaction_resolved' && e.requestId === 'call-plan' && e.approved === false)).toBe(true)

    // The SDK may still settle the cancelled run as `finished`; a plan raised from
    // that late result must not re-create a pending decision.
    const late = await runtime.interactions.requestPlanApproval({ ...PLAN, requestId: 'call-plan-late' })
    expect(late).toEqual({ kind: 'cancelled', reason: 'interrupted' })
    expect(session.getPendingInteractions()).toEqual([])
    expect(events.some((e) => e.type === 'plan_approval' && e.request.requestId === 'call-plan-late')).toBe(false)

    release?.()
    await second
    // Nothing switched modes or queued an implementation turn.
    expect(events.some((e) => e.type === 'permission_mode_change')).toBe(false)
    expect(runtimes).toHaveLength(1)
    expect(runtime.sends.map((s) => s.content)).toEqual(['plan it', 'plan more'])
  })

  it('plan: an approval superseded before its continuation runs neither rebuilds nor sends', async () => {
    let release: (() => void) | null = null
    const runtimes = installRuntimeFactory((runtime, index) => {
      if (index !== 0) return
      // The plan is raised while the run is still settling, so the decision has to
      // wait for the turn — long enough for the user to change their mind.
      runtime.onSend = () => {
        void runtime.interactions.requestPlanApproval(PLAN)
        return new Promise<void>((resolve) => { release = resolve })
      }
    })
    const { session, events } = makeSession('plan')
    const first = session.send({ content: 'plan it', assistantMessageId: 'a1' })
    await tick()
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(1)

    session.respondToPlanApproval('call-plan', true)
    await tick()
    expect(session.getPendingInteractions()).toEqual([])
    // Continuation is parked on the active turn; the user stops that turn instead.
    await session.interrupt()
    release?.()
    await first
    for (let i = 0; i < 10; i++) await tick()

    expect(events.some((e) => e.type === 'permission_mode_change')).toBe(false)
    expect(events.some((e) => e.type === 'message_error')).toBe(false)
    expect(runtimes).toHaveLength(1)
    expect(runtimes[0]!.sends.map((s) => s.content)).toEqual(['plan it'])

    // The newer turn still runs in plan mode on the untouched runtime.
    runtimes[0]!.onSend = async () => undefined
    await session.send({ content: 'different idea', assistantMessageId: 'a2' })
    expect(runtimes[0]!.permissionMode).toBe('plan')
    expect(runtimes[0]!.sends.map((s) => s.content)).toEqual(['plan it', 'different idea'])
    expect(events.some((e) => e.type === 'permission_mode_change')).toBe(false)
  })

  it('plan: a continuation that cannot start surfaces a transcript error instead of looking settled', async () => {
    const runtimes = installRuntimeFactory()
    const { session, events } = makeSession('plan')
    await session.send({ content: 'plan it', assistantMessageId: 'a1' })
    // The post-approval rebuild (plan → agent) fails once; the revive succeeds.
    factoryMock.mockImplementationOnce(async () => { throw new Error('agent boot failed') })
    void runtimes[0]!.interactions.requestPlanApproval(PLAN)
    await tick()

    session.respondToPlanApproval('call-plan', true)
    for (let i = 0; i < 12; i++) await tick()

    const failure = events.find((e) => e.type === 'message_error')
    expect(failure).toBeDefined()
    expect(failure && failure.type === 'message_error' ? failure.error : '').toMatch(/did not start the plan implementation.*agent boot failed.*retry/is)
    // Failure is stated once, no automatic re-send, and the session is back in plan mode.
    expect(events.filter((e) => e.type === 'message_error')).toHaveLength(1)
    expect(runtimes.every((r) => r.sends.every((s) => !/approved the plan/i.test(s.content)))).toBe(true)
    expect(events.filter((e) => e.type === 'permission_mode_change').map((e) => e.type === 'permission_mode_change' && e.mode)).toEqual(['agent', 'plan'])
    expect(session.getPendingInteractions()).toEqual([])
  })

  it('close: releases every pending resolver and clears the summary', async () => {
    const runtimes = installRuntimeFactory()
    const { session, transport } = makeSession()
    let release: (() => void) | null = null
    const sendDone = session.send({ content: 'go', assistantMessageId: 'a1' })
    await tick()
    const runtime = runtimes[0]!
    runtime.onSend = () => new Promise<void>((resolve) => { release = resolve })
    const question = runtime.interactions.askQuestion(QUESTION)
    const plan = runtime.interactions.requestPlanApproval(PLAN)
    await tick()
    expect(session.getPendingInteractions()).toHaveLength(2)

    await session.dispose()
    await expect(question).resolves.toMatchObject({ kind: 'cancelled' })
    await expect(plan).resolves.toMatchObject({ kind: 'cancelled' })
    expect(session.getPendingInteractions()).toEqual([])
    const resolved = transport.sent.filter((e) => e.type === 'interaction_resolved')
    expect(resolved).toHaveLength(0) // no subscribers: routed events drop, summaries still flow
    expect(activities(transport.sent).some((a) => a.pendingCount === 2)).toBe(true)
    release?.()
    await sendDone.catch(() => undefined)
  })

  it('never claims native Cursor permission approvals', () => {
    const backend = new CursorBackend()
    expect(backend.respondToPermission()).toBe(false)
  })
})
