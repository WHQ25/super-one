/**
 * Host-owned input requests for local sessions: declarative forms the agent
 * (`composer_request`), a mini-app or a widget shows in a session's composer.
 *
 * Each request is a host `permission_request` (`requestKind: 'input_request'`)
 * parked in a `HostConfirmRegistry`, so every client of the session — main and
 * mini windows, the phone — presents and restores it through the existing
 * permission stream, and the first valid answer wins. Requests have no
 * deadline: the turn signal, the owner (mini-app host, widget message) or the
 * session ends them. See docs/features/composer.md.
 */
import { realpathSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent, ChatMessage, ComposerOpenResult, ContentBlock, PermissionRequest, SendMessageRequest } from '@superone/shared/agent-types'
import { resolveAttachmentsDir } from '@superone/shared/attachment-store'
import {
  admitInputRequestSpec,
  INPUT_REQUEST_HOST_TOOL_NAME,
  INPUT_REQUEST_TOOL_NAME,
  inputRequestErrorMessage,
  inputRequestMessageText,
  inputRequestMeta,
  type InputRequestCancelReason,
  type InputRequestErrorCode,
  type InputRequestForm,
  type InputRequestMeta,
  type InputRequestOutcome,
  type InputRequestOutput,
} from '@superone/shared/input-request'
import { LruMap } from '@superone/shared/lru-map'
import { McpAppsError } from '@superone/shared/mcp-apps'
import { matchesResourceAccept } from '@superone/shared/mcp-form-resources'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { superoneBareToolName } from '@superone/shared/superone-host-owned-tools'
import { acceptedElicitationContent, type SchemaForm, type SchemaFormResource } from '@superone/shared/schema-form'
import { inferMimeType } from '../file-bridge'
import log from '../logger'
import { HostConfirmRegistry } from './host-confirm-registry'

export interface InputRequestSession {
  readonly id: string
  emitHostEvent?(event: AgentEvent): void
}

interface Entry {
  sessionId: string
  meta: InputRequestMeta
  form: InputRequestForm
  /** Quota group: `miniapp:<projectDir>:<appId>` / `widget:<sessionId>:<messageId>`. */
  owner?: string
  /** Files the native picker returned, per field — the only local paths a desktop answer may carry. */
  picked: Map<string, SchemaFormResource[]>
  picking: boolean
  unlisten?: () => void
}

export interface OpenInputRequestOptions {
  meta: InputRequestMeta
  form: InputRequestForm
  /** Agent requests: the turn signal. Interrupting the turn cancels the form. */
  signal?: AbortSignal
  owner?: string
}

/** Why a mini-app or widget form could not be shown; `message` is author-facing. */
export class InputRequestOpenError extends Error {
  constructor(readonly code: Extract<ComposerOpenResult, { ok: false }>['error']['code'], message: string) {
    super(message)
  }
}

/** A shown mini-app or widget form; the opener receives `outcome`. */
export interface OpenedInputRequest {
  requestId: string
  sessionId: string
  output: InputRequestOutput
  outcome: Promise<InputRequestOutcome>
}

/** Its message carries the code (`inputRequestErrorMessage`) so the sending client can tell a rejection from a transport failure. */
export class InputRequestError extends Error {
  constructor(readonly code: InputRequestErrorCode, readonly reason: string) {
    super(inputRequestErrorMessage(code, reason))
  }
}

const registry = new HostConfirmRegistry<InputRequestOutcome>({ idPrefix: 'inputrequest' })
const entries = new Map<string, Entry>()
/** Accepted agent-output submissions, so a send retried after a lost ACK is admitted again. */
const claims = new LruMap<string, { clientMessageId: string; content: string }>(256)

function stagingRoot(): string {
  return path.join(resolveAttachmentsDir(), 'input-requests')
}

/** Where a phone upload bound to this request field lands; nothing else writes there. */
export function inputRequestUploadDir(requestId: string, field: string): string {
  return path.join(stagingRoot(), requestId, encodeURIComponent(field))
}

function settle(requestId: string, outcome: InputRequestOutcome): boolean {
  const entry = entries.get(requestId)
  if (!entry) return false
  entries.delete(requestId)
  entry.unlisten?.()
  if (outcome.status === 'cancelled') {
    void rm(path.join(stagingRoot(), requestId), { recursive: true, force: true }).catch(() => {})
  }
  return registry.settle(requestId, outcome.status === 'submitted', outcome)
}

export function cancelInputRequest(requestId: string, reason: InputRequestCancelReason): boolean {
  return settle(requestId, { status: 'cancelled', reason })
}

function cancelWhere(match: (entry: Entry) => boolean, reason: InputRequestCancelReason): number {
  let count = 0
  for (const [requestId, entry] of [...entries]) {
    if (match(entry) && cancelInputRequest(requestId, reason)) count++
  }
  return count
}

export function cancelInputRequestsForSession(sessionId: string): number {
  return cancelWhere(entry => entry.sessionId === sessionId, 'session_removed')
}

export function cancelInputRequestsForOwner(owner: string): number {
  return cancelWhere(entry => entry.owner === owner, 'owner_disposed')
}

export function liveInputRequestCount(filter: { sessionId: string; owner?: string }): number {
  let count = 0
  for (const entry of entries.values()) {
    if (entry.sessionId === filter.sessionId && (filter.owner === undefined || entry.owner === filter.owner)) count++
  }
  return count
}

export function isInputRequestId(requestId: string): boolean {
  return entries.has(requestId)
}

/**
 * Show the form and return its id at once; `outcome` settles on the first
 * valid answer, a cancel, the signal, the owner or the session going away.
 */
export function openInputRequest(
  session: InputRequestSession,
  options: OpenInputRequestOptions,
): { requestId: string; outcome: Promise<InputRequestOutcome> } {
  if (options.signal?.aborted) {
    return { requestId: '', outcome: Promise.resolve({ status: 'cancelled', reason: 'aborted' }) }
  }
  let requestId = ''
  const outcome = registry.open(session, (id) => {
    requestId = id
    const entry: Entry = {
      sessionId: session.id,
      meta: options.meta,
      form: options.form,
      ...(options.owner ? { owner: options.owner } : {}),
      picked: new Map(),
      picking: false,
    }
    if (options.signal) {
      const signal = options.signal
      const onAbort = () => cancelInputRequest(id, 'aborted')
      signal.addEventListener('abort', onAbort, { once: true })
      entry.unlisten = () => signal.removeEventListener('abort', onAbort)
    }
    entries.set(id, entry)
    return inputPermissionRequest(id, options.meta, options.form)
  })
  return { requestId, outcome }
}

function inputPermissionRequest(requestId: string, meta: InputRequestMeta, form: InputRequestForm): PermissionRequest {
  return {
    requestId,
    toolName: meta.origin.kind === 'agent' ? INPUT_REQUEST_TOOL_NAME : INPUT_REQUEST_HOST_TOOL_NAME,
    toolUseId: requestId,
    input: {},
    allowAlwaysAllow: false,
    requestKind: 'input_request',
    serverName: 'superone',
    message: meta.title,
    schemaForm: form,
    inputRequest: meta,
  }
}

// Synchronous: a response must report at once whether it settled the form.
function isStagedUpload(requestId: string, field: string, file: string): boolean {
  try {
    const canonical = realpathSync(file)
    return path.dirname(canonical) === realpathSync(inputRequestUploadDir(requestId, field)) && statSync(canonical).isFile()
  } catch {
    return false
  }
}

/**
 * The form, with each file field's options extended by the files this request
 * can vouch for: the native picker's results and bound uploads that landed.
 */
function formWithProvenFiles(requestId: string, entry: Entry, answers: Record<string, unknown>): SchemaForm {
  const fields = entry.form.fields.map((field) => {
    if (field.kind !== 'resource' || !field.userOptions) return field
    const proven = [...field.options, ...(entry.picked.get(field.name) ?? [])]
    const raw = answers[field.name]
    for (const uri of typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : []) {
      if (typeof uri !== 'string' || !uri.startsWith('file:') || proven.some(option => option.uri === uri)) continue
      let file: string
      try { file = fileURLToPath(uri) } catch { continue }
      if (!isStagedUpload(requestId, field.name, file)) continue
      if (!matchesResourceAccept(path.basename(file), inferMimeType(file), field.userOptions.accept)) continue
      proven.push({ uri, name: path.basename(file) })
    }
    return { ...field, options: proven }
  })
  return { supported: true, fields }
}

function validatedValues(requestId: string, entry: Entry, formAnswers: unknown) {
  if (!formAnswers || typeof formAnswers !== 'object' || Array.isArray(formAnswers)) {
    throw new InputRequestError('invalid', 'The answer carries no form values')
  }
  const answers = formAnswers as Record<string, unknown>
  const form = formWithProvenFiles(requestId, entry, answers)
  const accepted = acceptedElicitationContent(form, answers)
  if (!accepted.ok) throw new InputRequestError('invalid', accepted.reason)
  return accepted.content
}

/**
 * A client's answer through the permission channel. Cancel/deny always
 * succeeds; submitting needs a values object (older phones send none, which
 * leaves the form pending for a client that understands it) and is only for
 * `caller` output — `agent` output is submitted with an ordinary send.
 */
export function answerInputRequest(
  sessionId: string,
  requestId: string,
  answer: { allow: boolean; decision?: 'cancel'; formAnswers?: Record<string, unknown> },
): { ok: true } | { ok: false; error: string } {
  const entry = entries.get(requestId)
  if (!entry || entry.sessionId !== sessionId) return { ok: false, error: 'This form is no longer open' }
  if (!answer.allow || answer.decision === 'cancel') {
    cancelInputRequest(requestId, 'user')
    return { ok: true }
  }
  if (entry.meta.output !== 'caller') return { ok: false, error: 'This form is submitted by sending it to the agent' }
  let values: ReturnType<typeof validatedValues>
  try {
    values = validatedValues(requestId, entry, answer.formAnswers)
  } catch (error) {
    const reason = error instanceof InputRequestError ? error.reason : (error as Error).message
    log.warn('[input-requests] %s: rejected answer: %s', requestId, reason)
    return { ok: false, error: reason }
  }
  settle(requestId, { status: 'submitted', values })
  return { ok: true }
}

export function respondToInputRequest(...args: Parameters<typeof answerInputRequest>): boolean {
  return answerInputRequest(...args).ok
}

/**
 * Bind an ordinary send to an `agent`-output form: validate, claim the form
 * first-wins, and replace the message body with the deterministic text. A
 * retry of an accepted send (same client message id) is admitted again.
 */
export function claimInputRequestForSend(sessionId: string, request: SendMessageRequest): SendMessageRequest {
  const submission = request.inputRequest
  if (!submission) return request
  const clientMessageId = request.clientMessageId
  if (!clientMessageId) throw new InputRequestError('invalid', 'A form submission needs a client message id')
  const bound = (content: string): SendMessageRequest => {
    const { inputRequest: _submission, userMessageContent: _content, images: _images, contexts: _contexts, ...rest } = request
    // Codex runs `codex.prompt` when present, so it carries the same host text.
    return { ...rest, content, ...(rest.codex?.prompt !== undefined ? { codex: { ...rest.codex, prompt: content } } : {}) }
  }
  const claimed = claims.get(submission.requestId)
  if (claimed) {
    if (claimed.clientMessageId !== clientMessageId) throw new InputRequestError('already_resolved', 'This form was already submitted')
    return bound(claimed.content)
  }
  const entry = entries.get(submission.requestId)
  if (!entry || entry.sessionId !== sessionId) throw new InputRequestError('already_resolved', 'This form is no longer open')
  if (entry.meta.output !== 'agent') throw new InputRequestError('invalid', 'This form answers its requester, not the agent')
  const values = validatedValues(submission.requestId, entry, submission.values)
  const content = inputRequestMessageText(entry.meta, entry.form, values)
  claims.set(submission.requestId, { clientMessageId, content })
  settle(submission.requestId, { status: 'submitted', values })
  return bound(content)
}

/** The native picker's view of a desktop file field, or `undefined` when the id is not an input request. */
export function inputRequestPickContext(sessionId: string, requestId: string) {
  const entry = entries.get(requestId)
  if (!entry || entry.sessionId !== sessionId) return undefined
  return {
    request: { schemaForm: entry.form, serverName: 'superone', inputRequest: entry.meta },
    localFiles: true,
    picked: entry.picked,
    get picking() { return entry.picking },
    set picking(value: boolean) { entry.picking = value },
    assertCurrent() {
      if (entries.get(requestId) !== entry) throw new McpAppsError('inactive', 'The form is no longer pending')
    },
  }
}

/** The upload directory for a phone file answering `field`, after checking the request still asks for it. */
export function inputRequestUploadTarget(sessionId: string | undefined, requestId: string, field: string, name: string): string {
  const entry = entries.get(requestId)
  if (!entry || entry.sessionId !== sessionId) throw new InputRequestError('not_found', 'The form is no longer pending')
  const target = entry.form.fields.find(candidate => candidate.name === field)
  if (target?.kind !== 'resource' || target.userOptions?.kind !== 'file') {
    throw new InputRequestError('invalid', 'This form field does not accept files')
  }
  if (!matchesResourceAccept(name, inferMimeType(name), target.userOptions.accept)) {
    throw new InputRequestError('invalid', 'The file does not match the allowed file types')
  }
  return inputRequestUploadDir(requestId, field)
}

/** Test helper — drop live requests without settling their waiters. */
export function clearInputRequestsForTests(): void {
  for (const entry of entries.values()) entry.unlisten?.()
  entries.clear()
  claims.clear()
  registry.clearForTests()
}

type WidgetMessage = Pick<ChatMessage, 'id' | 'role'> & { content?: ReadonlyArray<ContentBlock>; metadata?: ChatMessage['metadata'] }

export interface WidgetInputSession extends InputRequestSession {
  readonly projectPath: string
  readonly snapshot: { messages: ReadonlyArray<WidgetMessage> }
}

const WIDGET_TOOL_NAMES = new Set(['widget_show', 'mcp__superone.widget_show'])

/** Claude/ACP keep tool blocks in `content`; Codex keeps MCP calls as thread items. */
function hasCompletedWidget(message: WidgetMessage): boolean {
  if (message.content?.some(block => block.type === 'tool_use'
    && WIDGET_TOOL_NAMES.has(superoneBareToolName(block.toolName)) && block.status !== 'streaming')) return true
  return message.metadata?.codex?.items?.some(item => item.type === 'mcp_tool_call'
    && item.server === 'superone' && item.tool === 'widget_show' && item.status === 'completed' && !item.result?.isError) ?? false
}

/**
 * A completed widget opens a form in its own local session: `caller` output
 * answers the widget frame, `agent` output sends the values as a user message.
 * Throws `InputRequestOpenError` when the form cannot be shown.
 */
export function openWidgetInputRequest(
  session: WidgetInputSession | null | undefined,
  input: { projectPath: string; sessionId: string; messageId: string; spec: unknown; output: InputRequestOutput },
): OpenedInputRequest {
  if (parseRemoteProjectKey(input.projectPath)) throw new InputRequestOpenError('unsupported', 'Widget forms are not available in remote sessions yet')
  if (!session || session.id !== input.sessionId || session.projectPath !== input.projectPath) throw new InputRequestOpenError('not_found', 'The session is not open')
  const message = session.snapshot.messages.find(candidate => candidate.id === input.messageId)
  if (message?.role !== 'assistant' || !hasCompletedWidget(message)) {
    throw new InputRequestOpenError('not_found', 'Only a completed widget in this session can open a form')
  }
  const owner = `widget:${session.id}:${input.messageId}`
  if (liveInputRequestCount({ sessionId: session.id, owner }) > 0) throw new InputRequestOpenError('busy', 'This widget already has an open form')
  const admitted = admitInputRequestSpec(input.spec, { userResources: true })
  if (!admitted.ok) throw new InputRequestOpenError('invalid', admitted.error)
  const { requestId, outcome } = openInputRequest(session, {
    meta: inputRequestMeta(admitted.spec, { kind: 'widget', messageId: input.messageId }, input.output),
    form: admitted.form,
    owner,
  })
  return { requestId, sessionId: session.id, output: input.output, outcome }
}

/** The acknowledgement a requester receives for an open attempt. */
export function composerOpenResult(open: () => OpenedInputRequest): ComposerOpenResult {
  try {
    return { ok: true, requestId: open().requestId }
  } catch (error) {
    if (error instanceof InputRequestOpenError) return { ok: false, error: { code: error.code, message: error.message } }
    throw error
  }
}
