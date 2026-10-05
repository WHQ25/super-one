/**
 * Input requests: a declarative form shown in a session's composer slot on
 * behalf of the agent (`composer_request`), a mini-app, or a widget.
 *
 * The form is a flat elicitation `requestedSchema`, admitted only through
 * `parseSchemaForm`, so every renderer and validator already understands it.
 * The request travels as a host `permission_request` with
 * `requestKind: 'input_request'`; this module owns the spec admission and the
 * deterministic text an agent-output submission sends. Metro-safe.
 */
import type { SuperOneComposerOutcome } from './composer-api'
import { parseSchemaForm, type SchemaForm, type SchemaFormField, type SchemaFormValue } from './schema-form'

/** Bare agent tool name; chat shows it as `mcp__superone__composer_request`. */
export const INPUT_REQUEST_TOOL_NAME = 'composer_request'
/** `PermissionRequest.toolName` for forms opened by a mini-app or widget. */
export const INPUT_REQUEST_HOST_TOOL_NAME = 'superone_input_request'

export interface InputRequestSpec {
  title: string
  description?: string
  /** Flat elicitation schema; admitted only through `parseSchemaForm`. */
  requestedSchema: Record<string, unknown>
  submitLabel?: string
}

export type InputRequestOrigin =
  | { kind: 'agent' }
  | { kind: 'miniapp'; appId: string; appName?: string }
  | { kind: 'widget'; messageId: string }

/** UI-facing metadata carried on the `PermissionRequest`. */
export interface InputRequestMeta {
  title: string
  description?: string
  submitLabel?: string
  origin: InputRequestOrigin
  /** `caller`: the answer returns to the requester. `agent`: submitting sends a user message. */
  output: InputRequestOutput
}

export type InputRequestOutput = 'caller' | 'agent'

/** A requester's `output` option; omitted means `caller`. `null` when invalid. */
export function admitInputRequestOutput(raw: unknown): InputRequestOutput | null {
  if (raw === undefined) return 'caller'
  return raw === 'caller' || raw === 'agent' ? raw : null
}

export type InputRequestCancelReason = 'user' | 'aborted' | 'owner_disposed' | 'session_removed'

export type InputRequestOutcome =
  | { status: 'submitted'; values: Record<string, SchemaFormValue> }
  | { status: 'cancelled'; reason: InputRequestCancelReason }

/** The prompt metadata for an admitted spec. */
export function inputRequestMeta(spec: InputRequestSpec, origin: InputRequestMeta['origin'], output: InputRequestMeta['output']): InputRequestMeta {
  return {
    title: spec.title,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.submitLabel ? { submitLabel: spec.submitLabel } : {}),
    origin,
    output,
  }
}

/** What a mini-app or widget opener receives: an `agent` answer's values went to the agent only. */
export function composerOutcome(output: InputRequestOutput, outcome: InputRequestOutcome): SuperOneComposerOutcome {
  return output === 'agent' && outcome.status === 'submitted' ? { status: 'submitted' } : outcome
}

/** What `composer_request` returns to the turn, on desktop and on nodes. */
export function composerRequestResultValue(outcome: InputRequestOutcome): Record<string, unknown> {
  if (outcome.status === 'submitted') return outcome
  return {
    ...outcome,
    hint: 'The user closed the form without submitting it. Do not reopen it on your own — wait for the user.',
  }
}

export type InputRequestErrorCode = 'invalid' | 'already_resolved' | 'not_found'

const ERROR_PATTERN = /\[input_request:(invalid|already_resolved|not_found)\] ?([\s\S]*)$/

/** A host rejection that survives IPC/relay error wrapping, e.g. `[input_request:invalid] summary: required`. */
export function inputRequestErrorMessage(code: InputRequestErrorCode, message: string): string {
  return `[input_request:${code}] ${message}`
}

/** The code of a rejected form submission inside any wrapped error text; `null` for other failures. */
export function parseInputRequestError(text: string): { code: InputRequestErrorCode; message: string } | null {
  const match = ERROR_PATTERN.exec(text)
  return match ? { code: match[1] as InputRequestErrorCode, message: match[2]! } : null
}

/** Bound to an ordinary send when an `agent`-output form is submitted. */
export interface InputRequestSubmission {
  requestId: string
  values: Record<string, unknown>
}

export type InputRequestForm = Extract<SchemaForm, { supported: true }>

export type InputRequestAdmission =
  | { ok: true; spec: InputRequestSpec; form: InputRequestForm }
  | { ok: false; error: string }

export interface InputRequestHost {
  /** The host can prove which files the user chose (native picker / bound upload). */
  userResources: boolean
}

const MAX_SPEC_BYTES = 64 * 1024
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 4000
const MAX_SUBMIT_LABEL_LENGTH = 40
const SPEC_KEYS = new Set(['title', 'description', 'requestedSchema', 'submitLabel'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(raw: Record<string, unknown>, key: string, max: number): string | undefined | Error {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') return new Error(`"${key}" must be a string`)
  const text = value.trim()
  if ([...text].length > max) return new Error(`"${key}" is longer than ${max} characters`)
  return text || undefined
}

/**
 * Check a caller's spec before anything reaches the slot. Unknown keys, an
 * unsupported or empty form, and file fields on a host that cannot prove the
 * user's choice are rejected whole, never partially shown.
 */
export function admitInputRequestSpec(raw: unknown, host: InputRequestHost): InputRequestAdmission {
  if (!isRecord(raw)) return { ok: false, error: 'The form must be an object' }
  const unknown = Object.keys(raw).filter(key => !SPEC_KEYS.has(key))
  if (unknown.length > 0) return { ok: false, error: `Unknown form properties: ${unknown.join(', ')}` }
  let size: number
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length
  } catch {
    return { ok: false, error: 'The form is not serializable' }
  }
  if (size > MAX_SPEC_BYTES) return { ok: false, error: `The form is larger than ${MAX_SPEC_BYTES / 1024} KiB` }

  const title = optionalText(raw, 'title', MAX_TITLE_LENGTH)
  if (title instanceof Error) return { ok: false, error: title.message }
  if (!title) return { ok: false, error: '"title" is required' }
  const description = optionalText(raw, 'description', MAX_DESCRIPTION_LENGTH)
  if (description instanceof Error) return { ok: false, error: description.message }
  const submitLabel = optionalText(raw, 'submitLabel', MAX_SUBMIT_LABEL_LENGTH)
  if (submitLabel instanceof Error) return { ok: false, error: submitLabel.message }
  if (!isRecord(raw.requestedSchema)) return { ok: false, error: '"requestedSchema" must be a JSON Schema object' }

  // Parse with pickers allowed so a file field is recognized, then refuse it
  // where the host cannot back the answer with the user's own selection.
  const form = parseSchemaForm(raw.requestedSchema, { userResources: true })
  if (!form.supported) {
    return { ok: false, error: `Unsupported form${form.field ? ` field "${form.field}"` : ''}: ${form.reason}` }
  }
  if (form.fields.length === 0) return { ok: false, error: 'The form has no fields' }
  // A preview is read from the MCP server that asked; an input form has none.
  const previewed = form.fields.find(field => field.kind === 'resource' && field.options.some(option => option.preview))
  if (previewed) return { ok: false, error: `Field "${previewed.name}" uses option previews, which input forms do not support` }
  if (!host.userResources) {
    const file = form.fields.find(field => field.kind === 'resource' && (field.userOptions || field.selection === 'implicit'))
    if (file) return { ok: false, error: `Field "${file.name}" asks for user files, which this session cannot collect yet` }
  }
  return {
    ok: true,
    form,
    spec: {
      title,
      ...(description ? { description } : {}),
      requestedSchema: raw.requestedSchema,
      ...(submitLabel ? { submitLabel } : {}),
    },
  }
}

/**
 * The `file:` URI a file-field answer carries for a host path, matching the
 * desktop picker's `pathToFileURL` once decoded. Phones use it for the path an
 * input-request upload returns.
 */
export function fileUriFromPath(path: string): string {
  const posix = path.replace(/\\/g, '/')
  const rooted = /^[A-Za-z]:\//.test(posix) ? `/${posix}` : posix
  return `file://${rooted.split('/').map(segment => /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)).join('/')}`
}

/** A path for a `file:` URI the picker produced; any other URI is returned as is. */
function displayUri(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  let path: string
  try {
    path = decodeURIComponent(uri.slice('file://'.length).replace(/^localhost(?=\/)/, ''))
  } catch {
    return uri
  }
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

function choiceText(field: SchemaFormField, value: string): string {
  if (field.kind === 'select' || field.kind === 'multiselect') {
    const option = field.options.find(candidate => candidate.value === value)
    if (option && option.label !== value) return `${option.label} (${value})`
  }
  if (field.kind === 'resource') {
    const option = field.options.find(candidate => candidate.uri === value)
    if (option && !value.startsWith('file://')) return `${option.title ?? option.name} (${value})`
    return displayUri(value)
  }
  return value
}

function valueText(field: SchemaFormField, value: SchemaFormValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(item => choiceText(field, item)).join(', ')
  return choiceText(field, value)
}

/**
 * The user message an `agent`-output form sends: the title, then one line per
 * answered field in form order. Identical on every client and on the host, so
 * an optimistic bubble matches what is admitted.
 */
export function inputRequestMessageText(
  meta: Pick<InputRequestMeta, 'title'>,
  form: SchemaForm,
  values: Record<string, SchemaFormValue>,
): string {
  const lines = [meta.title]
  if (!form.supported) return meta.title
  for (const field of form.fields) {
    const value = values[field.name]
    if (value === undefined) continue
    const text = valueText(field, value)
    if (text.includes('\n')) {
      lines.push(`${field.label}:`, ...text.split('\n').map(line => `  ${line}`))
    } else {
      lines.push(`${field.label}: ${text}`)
    }
  }
  return lines.join('\n')
}
