import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, SessionLoadRequest, SessionLoadResult } from '@superone/shared/environment'
import type { TranscriptFoldResult, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { processTurn, textMessage } from '@superone/shared/transcript-window/window-fixtures'
import { TranscriptWindowSync } from '@superone/shared/transcript-window/window-sync'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP } from '@superone/shared/transcript-window/window-store'
import { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { deliveryPolicy } from '../stream/delivery-policy'
import type { RpcContext, SessionHostPort } from './rpc-context'
import { handleSessionTranscriptFold, handleSessionTranscriptWindow } from './rpc-session-window'
import { deliverFrame } from './session-delivery'

const TOOLS = 40

function host(initial: ChatMessage[]) {
  let transcript = initial
  let version = 1
  const sessions = {
    get: (id: string) => (id === 's' ? { projectId: 'p' } : null),
    messages: () => transcript,
    load: (input: SessionLoadRequest): SessionLoadResult => ({
      sessionId: input.sessionId, state: {}, messages: [...transcript], before: null,
      cursor: { sequence: String(version), epoch: 'e', version },
    }),
  } as unknown as SessionHostPort
  return { sessions, set(next: ChatMessage[]) { transcript = next; version++ } }
}

function context(sessions: SessionHostPort): RpcContext & { delivery: ConnectionDelivery } {
  const delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
  return {
    client: { clientSessionId: 'c', scopes: ['session:read'], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' },
    sessions, streams: { delivery } as unknown as RpcContext['streams'], delivery,
  } as unknown as RpcContext & { delivery: ConnectionDelivery }
}

async function call<T>(handler: typeof handleSessionTranscriptWindow, ctx: RpcContext, payload: Record<string, unknown>): Promise<T> {
  const reply = await handler({ sessionId: 's', ...payload }, ctx)
  if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error)
  return reply.result as T
}

const conversation = (reply: ChatMessage) => [textMessage('u', 'user', 'Refactor it'), reply]

function foldOf(result: TranscriptWindowResult) {
  const fragment = result.messages.find((message) => message.id === 'a')!.fragments.find((f) => f.body?.kind === 'fold')!
  return { key: fragment.key, revision: fragment.body?.kind === 'fold' ? fragment.body.revision : '', summary: fragment.body?.kind === 'fold' ? fragment.body.summary : null }
}

describe('session.transcriptFold', () => {
  it('serves a settled turn folded, much lighter than whole', async () => {
    const h = host(conversation(processTurn('a', TOOLS)))
    const whole = await call<TranscriptWindowResult>(handleSessionTranscriptWindow, context(h.sessions), {})
    const folded = await call<TranscriptWindowResult>(handleSessionTranscriptWindow, context(h.sessions), { folds: true })
    expect(folded.messages.map((message) => message.id)).toEqual(['u', 'a'])
    expect(folded.messages[1].fragments).toHaveLength(2)
    expect(foldOf(folded).summary).toMatchObject({ toolCalls: TOOLS, fragments: 2 * TOOLS + 1 })
    expect(utf8Length(JSON.stringify(folded.messages))).toBeLessThan(utf8Length(JSON.stringify(whole.messages)) / 4)
  })

  it('pages a fold to its end with each call beside its result', async () => {
    const h = host(conversation(processTurn('a', TOOLS)))
    const ctx = context(h.sessions)
    const fold = foldOf(await call<TranscriptWindowResult>(handleSessionTranscriptWindow, ctx, { folds: true }))
    const pages: TranscriptFoldResult[] = []
    let after: string | undefined
    do {
      const page = await call<TranscriptFoldResult>(handleSessionTranscriptFold, ctx, { messageId: 'a', fold: fold.key, revision: fold.revision, ...(after ? { after } : {}), viewport: { width: 390, height: 844 } })
      pages.push(page)
      after = page.fragments.at(-1)?.key
    } while (pages.at(-1)!.rest)
    expect(pages.length).toBeGreaterThan(1)
    const fragments = pages.flatMap((page) => page.fragments)
    expect(fragments).toHaveLength(2 * TOOLS + 1)
    // The phone projection rewrites Bash outcomes to `bash_result`: a result is a block with a call id and no tool name.
    const isResult = (body: TranscriptFoldResult['fragments'][number]['body']) =>
      body.kind === 'block' && 'toolUseId' in body.block && !('toolName' in body.block)
    for (const page of pages) expect(isResult(page.fragments.at(-1)!.body)).toBe(true)
    // What the rest of the first page adds is what the later pages hold.
    const calls = (page: TranscriptFoldResult) => page.fragments.filter((f) => f.body.kind === 'block' && f.body.block.type === 'tool_use').length
    expect(pages[0].rest).toMatchObject({ toolCalls: TOOLS - calls(pages[0]), fragments: 2 * TOOLS + 1 - pages[0].fragments.length })
  })

  it('refuses a fold that changed or no longer exists', async () => {
    const h = host(conversation(processTurn('a', TOOLS)))
    const ctx = context(h.sessions)
    const fold = foldOf(await call<TranscriptWindowResult>(handleSessionTranscriptWindow, ctx, { folds: true }))
    await expect(call(handleSessionTranscriptFold, ctx, { messageId: 'a', fold: fold.key, revision: 'stale' })).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(call(handleSessionTranscriptFold, ctx, { messageId: 'a', fold: 'fold:gone', revision: fold.revision })).rejects.toMatchObject({ code: 'not_found' })
    await expect(call(handleSessionTranscriptFold, ctx, { messageId: 'gone', fold: fold.key, revision: fold.revision })).rejects.toMatchObject({ code: 'not_found' })
    await expect(call(handleSessionTranscriptFold, ctx, { messageId: 'a', fold: fold.key, revision: fold.revision, after: 'gone' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(call(handleSessionTranscriptFold, ctx, { messageId: 'a', fold: fold.key })).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('folds a reply the moment it settles, without losing what the client shows', async () => {
    const h = host(conversation(processTurn('a', 6, 'streaming')))
    const ctx = context(h.sessions)
    const opened = await call<TranscriptWindowResult>(handleSessionTranscriptWindow, ctx, { folds: true })
    expect(opened.messages[1].fragments.some((f) => f.body?.kind === 'fold')).toBe(false)
    const sync = new TranscriptWindowSync(applyWindowResult(null, opened, EMPTY_WINDOW_LOOKUP).state)
    const settled = processTurn('a', 6)
    h.set(conversation(settled))
    const complete: AgentEvent = { type: 'message_complete', sessionId: 's', messageId: 'a' }
    const envelope = { eventId: 'e2', environmentId: 'env', sequence: '2', aggregateType: 'session', aggregateId: 's', eventType: 'session.agent_event',
      eventVersion: 1, payload: { event: complete }, timestamp: 0, sessionVersion: 2 } as EnvironmentEventEnvelope
    const delivered = deliverFrame({ sequence: '2', epoch: 'e', events: [envelope] }, ctx.delivery, h.sessions).frame
    const patch = delivered.events.flatMap((e) => {
      const event = (e.payload as { event: AgentEvent }).event
      return event.type === 'transcript_window' ? [event.patch] : []
    })[0]
    expect(patch.messages[0].fragments.map((f) => f.key)).toEqual([expect.stringMatching(/^fold:/), expect.any(String)])
    expect(sync.applyPatch(patch)).toBe(true)
    // The client keeps the projected rows it showed; nothing behind the fold needs a read.
    const whole = await call<TranscriptWindowResult>(handleSessionTranscriptWindow, context(h.sessions), {})
    const shown = new TranscriptWindowSync(applyWindowResult(null, whole, EMPTY_WINDOW_LOOKUP).state).messages()[1]
    expect(sync.messages()[1].content).toEqual(shown.content)
    expect(sync.messages()[1].content.some((block) => block.type === 'notice')).toBe(false)
  })
})
