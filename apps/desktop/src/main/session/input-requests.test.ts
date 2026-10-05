import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { admitInputRequestSpec, fileUriFromPath, inputRequestMeta, type InputRequestForm } from '@superone/shared/input-request'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const {
  cancelInputRequestsForOwner,
  cancelInputRequestsForSession,
  claimInputRequestForSend,
  clearInputRequestsForTests,
  composerOpenResult,
  inputRequestPickContext,
  inputRequestUploadTarget,
  isInputRequestId,
  openInputRequest,
  openWidgetInputRequest,
  respondToInputRequest,
} = await import('./input-requests')

const spec = {
  title: 'Report a bug',
  requestedSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', title: 'Summary' },
      shot: {
        type: 'array', items: { type: 'string', format: 'uri' }, title: 'Screenshot',
        'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'file', accept: ['.png'] } },
      },
    },
    required: ['summary'],
  },
}

function admitted(): { spec: typeof spec; form: InputRequestForm } {
  const result = admitInputRequestSpec(spec, { userResources: true })
  if (!result.ok) throw new Error(result.error)
  return { spec: result.spec as typeof spec, form: result.form }
}

function fakeSession(id = 's1') {
  const events: AgentEvent[] = []
  return { id, events, emitHostEvent: (event: AgentEvent) => { events.push(event) } }
}

function open(session = fakeSession(), extra: { output?: 'caller' | 'agent'; owner?: string; signal?: AbortSignal } = {}) {
  const { form } = admitted()
  const opened = openInputRequest(session, {
    meta: inputRequestMeta(spec, extra.output === 'agent' ? { kind: 'widget', messageId: 'm1' } : { kind: 'agent' }, extra.output ?? 'caller'),
    form,
    ...(extra.owner ? { owner: extra.owner } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  })
  return { session, ...opened }
}

let attachmentsDir: string
beforeEach(async () => {
  attachmentsDir = await mkdtemp(path.join(tmpdir(), 'input-requests-'))
  vi.stubEnv('SUPERONE_ATTACHMENTS_DIR', attachmentsDir)
})
afterEach(async () => {
  clearInputRequestsForTests()
  vi.unstubAllEnvs()
  await rm(attachmentsDir, { recursive: true, force: true })
})

describe('input requests on the permission channel', () => {
  it('emits one input_request prompt carrying the parsed form and metadata', () => {
    const { session, requestId } = open()
    expect(session.events).toHaveLength(1)
    const event = session.events[0]!
    expect(event.type).toBe('permission_request')
    if (event.type !== 'permission_request') return
    expect(event.request).toMatchObject({
      requestId,
      toolName: 'composer_request',
      requestKind: 'input_request',
      allowAlwaysAllow: false,
      message: 'Report a bug',
      inputRequest: { title: 'Report a bug', origin: { kind: 'agent' }, output: 'caller' },
    })
    expect(event.request.schemaForm?.supported).toBe(true)
  })

  it('keeps the form pending for a missing or invalid answer, then settles once', async () => {
    const { session, requestId, outcome } = open()
    expect(respondToInputRequest('s1', requestId, { allow: true })).toBe(false)
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: {} })).toBe(false)
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: { summary: 'Crash', extra: 1 } })).toBe(true)
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: { summary: 'Late' } })).toBe(false)
    await expect(outcome).resolves.toEqual({ status: 'submitted', values: { summary: 'Crash' } })
    expect(session.events.at(-1)).toMatchObject({ type: 'interaction_resolved', requestId, approved: true })
    expect(isInputRequestId(requestId)).toBe(false)
  })

  it('ignores an answer addressed from another session', () => {
    const { requestId } = open()
    expect(respondToInputRequest('other', requestId, { allow: false, decision: 'cancel' })).toBe(false)
    expect(isInputRequestId(requestId)).toBe(true)
  })

  it('treats deny and cancel as a user cancel', async () => {
    const first = open()
    expect(respondToInputRequest('s1', first.requestId, { allow: false })).toBe(true)
    await expect(first.outcome).resolves.toEqual({ status: 'cancelled', reason: 'user' })
    const second = open()
    expect(respondToInputRequest('s1', second.requestId, { allow: true, decision: 'cancel' })).toBe(true)
    await expect(second.outcome).resolves.toEqual({ status: 'cancelled', reason: 'user' })
  })

  it('cancels on the turn signal, the owner and the session, emitting a resolution each time', async () => {
    const controller = new AbortController()
    const turn = open(fakeSession(), { signal: controller.signal })
    const app = open(fakeSession(), { owner: 'miniapp:/p:app' })
    const other = open(fakeSession('s2'))
    controller.abort()
    await expect(turn.outcome).resolves.toEqual({ status: 'cancelled', reason: 'aborted' })
    expect(cancelInputRequestsForOwner('miniapp:/p:app')).toBe(1)
    await expect(app.outcome).resolves.toEqual({ status: 'cancelled', reason: 'owner_disposed' })
    expect(cancelInputRequestsForSession('s2')).toBe(1)
    await expect(other.outcome).resolves.toEqual({ status: 'cancelled', reason: 'session_removed' })
    for (const { session, requestId } of [turn, app, other]) {
      expect(session.events.at(-1)).toMatchObject({ type: 'interaction_resolved', requestId, approved: false })
    }
  })

  it('never paints a form for an already aborted turn', async () => {
    const controller = new AbortController()
    controller.abort()
    const { session, outcome } = open(fakeSession(), { signal: controller.signal })
    expect(session.events).toEqual([])
    await expect(outcome).resolves.toEqual({ status: 'cancelled', reason: 'aborted' })
  })
})

describe('file answers', () => {
  it('accept only files the picker returned or a bound upload placed for that field', async () => {
    const { requestId, outcome } = open()
    const stray = path.join(attachmentsDir, 'stray.png')
    await writeFile(stray, 'x')
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: { summary: 'a', shot: [fileUriFromPath(stray)] } })).toBe(false)

    const picked = inputRequestPickContext('s1', requestId)!
    picked.picked.set('shot', [{ uri: 'file:///picked.png', name: 'picked.png' }])
    const dir = inputRequestUploadTarget('s1', requestId, 'shot', 'upload.png')
    await mkdir(dir, { recursive: true })
    const uploaded = path.join(dir, 'upload.png')
    await writeFile(uploaded, 'x')
    expect(respondToInputRequest('s1', requestId, {
      allow: true,
      formAnswers: { summary: 'a', shot: ['file:///picked.png', fileUriFromPath(uploaded)] },
    })).toBe(true)
    await expect(outcome).resolves.toMatchObject({ status: 'submitted', values: { shot: ['file:///picked.png', fileUriFromPath(uploaded)] } })
  })

  it('refuses uploads for unknown fields or the wrong file type', () => {
    const { requestId } = open()
    expect(() => inputRequestUploadTarget('s1', requestId, 'summary', 'a.png')).toThrow(/does not accept files/)
    expect(() => inputRequestUploadTarget('s1', requestId, 'shot', 'a.exe')).toThrow(/allowed file types/)
    expect(() => inputRequestUploadTarget('s2', requestId, 'shot', 'a.png')).toThrow(/no longer pending/)
  })
})

describe('agent-output submission through a send', () => {
  it('claims first-wins, replaces the body and re-admits a retry with the same message id', async () => {
    const { requestId, outcome } = open(fakeSession(), { output: 'agent' })
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: { summary: 'x' } })).toBe(false)
    expect(() => claimInputRequestForSend('s1', { content: 'x', inputRequest: { requestId, values: { summary: 'x' } } })).toThrow(/client message id/)

    const send = { content: 'forged', userMessageContent: [], clientMessageId: 'c1', inputRequest: { requestId, values: { summary: 'Crash' } } }
    const first = claimInputRequestForSend('s1', send)
    expect(first).toEqual({ content: 'Report a bug\nSummary: Crash', clientMessageId: 'c1' })
    await expect(outcome).resolves.toEqual({ status: 'submitted', values: { summary: 'Crash' } })
    expect(claimInputRequestForSend('s1', send)).toEqual(first)
    expect(() => claimInputRequestForSend('s1', { ...send, clientMessageId: 'c2' })).toThrow(/already submitted/)
  })

  it('gives Codex the host text as its prompt too', () => {
    const { requestId } = open(fakeSession(), { output: 'agent' })
    const bound = claimInputRequestForSend('s1', { content: 'x', clientMessageId: 'c1', codex: { mode: 'run', prompt: 'forged' }, inputRequest: { requestId, values: { summary: 'Crash' } } })
    expect(bound.codex).toEqual({ mode: 'run', prompt: 'Report a bug\nSummary: Crash' })
  })

  it('leaves the form open when the submitted values are invalid', () => {
    const { requestId } = open(fakeSession(), { output: 'agent' })
    expect(() => claimInputRequestForSend('s1', { content: '', clientMessageId: 'c1', inputRequest: { requestId, values: {} } })).toThrow(/summary/)
    expect(isInputRequestId(requestId)).toBe(true)
  })

  it('does not let a caller-output form be submitted as a message', () => {
    const { requestId } = open()
    expect(() => claimInputRequestForSend('s1', { content: '', clientMessageId: 'c1', inputRequest: { requestId, values: { summary: 'a' } } }))
      .toThrow(/answers its requester/)
  })
})

describe('openWidgetInputRequest', () => {
  const widgetMessage = {
    id: 'm1',
    role: 'assistant',
    content: [{ type: 'tool_use' as const, toolName: 'mcp__superone__widget_show', toolUseId: 't1', input: '{}', status: 'complete' as const }],
  }
  function widgetSession(messages = [widgetMessage]) {
    return { ...fakeSession(), projectPath: '/p', snapshot: { messages } }
  }
  function openWidget(session: Parameters<typeof openWidgetInputRequest>[0], input: { projectPath: string; sessionId: string; messageId: string; spec: unknown }, output: 'caller' | 'agent' = 'agent') {
    return composerOpenResult(() => openWidgetInputRequest(session, { ...input, output }))
  }

  it('opens an agent-output form owned by the widget message, once at a time', () => {
    const session = widgetSession()
    const result = openWidget(session, { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec })
    expect(result.ok).toBe(true)
    expect(session.events[0]).toMatchObject({ type: 'permission_request', request: { toolName: 'superone_input_request', inputRequest: { origin: { kind: 'widget', messageId: 'm1' }, output: 'agent' } } })
    expect(openWidget(session, { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec })).toMatchObject({ ok: false, error: { code: 'busy' } })
  })

  it('opens a caller-output form whose outcome goes back to the opener', async () => {
    const session = widgetSession()
    const opened = openWidgetInputRequest(session, { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec, output: 'caller' })
    expect(session.events[0]).toMatchObject({ request: { inputRequest: { origin: { kind: 'widget' }, output: 'caller' } } })
    expect(respondToInputRequest('s1', opened.requestId, { allow: true, formAnswers: { summary: 'a' } })).toBe(true)
    await expect(opened.outcome).resolves.toEqual({ status: 'submitted', values: { summary: 'a' } })
  })

  it('accepts a completed Codex widget call kept as a thread item', () => {
    const codexMessage = (status: string, isError = false) => ({
      id: 'm1', role: 'assistant', content: [],
      metadata: { codex: { threadId: 't', usage: null, items: [{ id: 'i1', type: 'mcp_tool_call', server: 'superone', tool: 'widget_show', arguments: {}, status, ...(isError ? { result: { content: [], structuredContent: null, isError } } : {}) }] } },
    })
    const open = (message: ReturnType<typeof codexMessage>) => openWidget(widgetSession([message] as never), { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec })
    expect(open(codexMessage('completed')).ok).toBe(true)
    clearInputRequestsForTests()
    expect(open(codexMessage('in_progress'))).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(open(codexMessage('completed', true))).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })

  it('rejects remote sessions, streaming or missing widgets and invalid specs without painting', () => {
    const streaming = widgetSession([{ ...widgetMessage, content: [{ ...widgetMessage.content[0]!, status: 'streaming' as const }] }])
    expect(openWidget(widgetSession(), { projectPath: 'remote:c1:/p', sessionId: 's1', messageId: 'm1', spec })).toMatchObject({ ok: false, error: { code: 'unsupported' } })
    expect(openWidget(streaming, { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec })).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(openWidget(widgetSession(), { projectPath: '/p', sessionId: 's1', messageId: 'nope', spec })).toMatchObject({ ok: false, error: { code: 'not_found' } })
    const invalid = widgetSession()
    expect(openWidget(invalid, { projectPath: '/p', sessionId: 's1', messageId: 'm1', spec: { title: 'x' } })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(invalid.events).toEqual([])
  })
})
