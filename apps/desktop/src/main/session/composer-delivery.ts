/**
 * Returns mini-app and widget form answers to the frame that opened them.
 *
 * A frame is a view (`viewId`) of one client: a desktop window or a paired
 * phone. Desktop frames await the answer over IPC; a phone receives it as a
 * `composer_settled` push to that device only, and asks once after
 * reconnecting if it missed one. Releasing a view closes its `caller` forms,
 * whose answer has no other recipient; `agent` forms stay, since their answer
 * goes to the agent. No deadlines: forms end by answer, cancel or release.
 */
import type { ComposerOpenResult, ComposerOutcomeResult, ComposerSettledEvent } from '@superone/shared/agent-types'
import type { SuperOneComposerOutcome } from '@superone/shared/composer-api'
import { admitInputRequestOutput, composerOutcome, type InputRequestOutput } from '@superone/shared/input-request'
import { LruMap } from '@superone/shared/lru-map'
import { cancelInputRequest, composerOpenResult, InputRequestOpenError, type OpenedInputRequest } from './input-requests'

export type ComposerClient = { kind: 'window'; id: number } | { kind: 'device'; id: string }

interface Delivery {
  client: ComposerClient
  viewId: string
  localId: string
  sessionId: string
  output: InputRequestOutput
  waiters: Array<(outcome: SuperOneComposerOutcome) => void>
}

const MAX_ID_LENGTH = 128
/** Answers nobody has collected yet: a window that never awaited, a phone that missed its push. */
const MAX_UNCOLLECTED = 128

const open = new Map<string, Delivery>()
const byLocalId = new Map<string, string>()
const uncollected = new LruMap<string, { client: ComposerClient; viewId: string; outcome: SuperOneComposerOutcome }>(MAX_UNCOLLECTED)

let pushToDevice: ((deviceId: string, event: ComposerSettledEvent) => void) | null = null

export function setComposerDevicePush(push: (deviceId: string, event: ComposerSettledEvent) => void): void {
  pushToDevice = push
}

function sameClient(a: ComposerClient, b: ComposerClient): boolean {
  return a.kind === b.kind && a.id === b.id
}

function localKey(client: ComposerClient, viewId: string, localId: string): string {
  return JSON.stringify([client.kind, client.id, viewId, localId])
}

function isFrameId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function detach(requestId: string, delivery: Delivery): void {
  open.delete(requestId)
  byLocalId.delete(localKey(delivery.client, delivery.viewId, delivery.localId))
}

function deliver(requestId: string, outcome: SuperOneComposerOutcome): void {
  const delivery = open.get(requestId)
  if (!delivery) return
  detach(requestId, delivery)
  if (delivery.waiters.length > 0) {
    for (const resolve of delivery.waiters) resolve(outcome)
    return
  }
  uncollected.set(requestId, { client: delivery.client, viewId: delivery.viewId, outcome })
  if (delivery.client.kind === 'device') {
    pushToDevice?.(delivery.client.id, {
      type: 'composer_settled',
      sessionId: delivery.sessionId,
      requestId,
      viewId: delivery.viewId,
      localId: delivery.localId,
      outcome,
    })
  }
}

/**
 * Show a form for a frame and acknowledge at once. `show` opens it (throwing
 * `InputRequestOpenError` when it cannot); the frame's ids are registered
 * before this returns, so a cancel sent right after the open finds it.
 */
export function openComposerForm(
  client: ComposerClient,
  frame: { viewId: unknown; localId: unknown; output?: unknown },
  show: (output: InputRequestOutput) => OpenedInputRequest,
): ComposerOpenResult {
  return composerOpenResult(() => {
    const { viewId, localId } = frame
    if (!isFrameId(viewId) || !isFrameId(localId)) throw new InputRequestOpenError('invalid', 'The form needs a view id and a local id')
    const output = admitInputRequestOutput(frame.output)
    if (!output) throw new InputRequestOpenError('invalid', '"output" must be "caller" or "agent"')
    const key = localKey(client, viewId, localId)
    if (byLocalId.has(key)) throw new InputRequestOpenError('invalid', 'This local id already has an open form')
    const opened = show(output)
    const delivery: Delivery = { client, viewId, localId, sessionId: opened.sessionId, output: opened.output, waiters: [] }
    open.set(opened.requestId, delivery)
    byLocalId.set(key, opened.requestId)
    void opened.outcome.then(outcome => deliver(opened.requestId, composerOutcome(opened.output, outcome)))
    return opened
  })
}

/** A desktop window's wait for its form's answer; rejects at once for a form it did not open. */
export function awaitComposerForm(client: ComposerClient, requestId: string): Promise<SuperOneComposerOutcome> {
  const delivery = open.get(requestId)
  if (delivery && sameClient(delivery.client, client)) {
    return new Promise(resolve => { delivery.waiters.push(resolve) })
  }
  const settled = uncollected.get(requestId)
  if (settled && sameClient(settled.client, client)) {
    uncollected.delete(requestId)
    return Promise.resolve(settled.outcome)
  }
  return Promise.reject(new Error('This form is not open in this window'))
}

/** A phone's one-time check after reconnecting. A settled answer is handed over once. */
export function composerFormOutcome(client: ComposerClient, requestId: string): ComposerOutcomeResult {
  const delivery = open.get(requestId)
  if (delivery && sameClient(delivery.client, client)) return { state: 'pending' }
  const settled = uncollected.get(requestId)
  if (!settled || !sameClient(settled.client, client)) return { state: 'unknown' }
  uncollected.delete(requestId)
  return { state: 'settled', outcome: settled.outcome }
}

/** Cancel one form of a view, or with no `localId` release the whole view. */
export function cancelComposerForms(client: ComposerClient, viewId: string, localId?: string): void {
  if (localId !== undefined) {
    const requestId = byLocalId.get(localKey(client, viewId, localId))
    if (requestId) cancelInputRequest(requestId, 'aborted')
    return
  }
  releaseWhere(delivery => sameClient(delivery.client, client) && delivery.viewId === viewId)
  for (const [requestId, settled] of [...uncollected]) {
    if (sameClient(settled.client, client) && settled.viewId === viewId) uncollected.delete(requestId)
  }
}

/** A closed window or forgotten device: release all of its views. */
export function releaseComposerClient(client: ComposerClient): void {
  releaseWhere(delivery => sameClient(delivery.client, client))
  for (const [requestId, settled] of [...uncollected]) {
    if (sameClient(settled.client, client)) uncollected.delete(requestId)
  }
}

function releaseWhere(match: (delivery: Delivery) => boolean): void {
  for (const [requestId, delivery] of [...open]) {
    if (!match(delivery)) continue
    detach(requestId, delivery)
    for (const resolve of delivery.waiters) resolve({ status: 'cancelled', reason: 'owner_disposed' })
    if (delivery.output === 'caller') cancelInputRequest(requestId, 'owner_disposed')
  }
}

/** Test helper. */
export function clearComposerDeliveriesForTests(): void {
  open.clear()
  byLocalId.clear()
  uncollected.clear()
  pushToDevice = null
}
