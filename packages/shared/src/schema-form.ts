/**
 * Declarative forms described by a flat JSON Schema: MCP form elicitation
 * (2025-11-25) plus OpenAI's extended forms (`openai/elicitation`). One model
 * for every harness and every renderer (desktop, phone).
 *
 * A form containing any input SuperOne cannot render parses as `unsupported`
 * and is never partially displayed, as OpenAI's spec requires.
 */
import type { ElicitationFormField, PermissionRequest } from './agent-types'
import { safeMcpAppImage } from './mcp-apps-metadata'

export type SchemaFormTextFormat = 'email' | 'uri' | 'date' | 'date-time'

export interface SchemaFormImage {
  /** Filtered by `safeMcpAppImage`; an unsafe source is dropped at parse time. */
  src: string
  mimeType?: string
}

export interface SchemaFormOption {
  value: string
  label: string
  description?: string
  thumbnail?: SchemaFormImage
}

export type SchemaFormPreviewTarget =
  | { type: 'mcp_app_tool'; name: string; arguments: Record<string, unknown> }
  | { type: 'resource_link'; uri: string; name: string; title?: string; mimeType?: string }

export interface SchemaFormResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  thumbnail?: SchemaFormImage
  preview?: SchemaFormPreviewTarget
}

export interface SchemaFormTextConstraints {
  format?: SchemaFormTextFormat
  pattern?: string
  minLength?: number
  maxLength?: number
}

interface SchemaFormFieldBase {
  name: string
  label: string
  description?: string
  required: boolean
}

export type SchemaFormField =
  | SchemaFormFieldBase & SchemaFormTextConstraints & {
    kind: 'text'
    /** Suggested values; free text stays allowed. */
    suggestions?: SchemaFormOption[]
    default?: string
  }
  | SchemaFormFieldBase & { kind: 'number'; integer: boolean; minimum?: number; maximum?: number; default?: number }
  | SchemaFormFieldBase & { kind: 'boolean'; default?: boolean }
  | SchemaFormFieldBase & { kind: 'select'; options: SchemaFormOption[]; default?: string }
  | SchemaFormFieldBase & {
    kind: 'multiselect'
    options: SchemaFormOption[]
    minItems?: number
    maxItems?: number
    default?: string[]
  }
  | SchemaFormFieldBase & {
    /** Free-text string array, optionally with suggested values. */
    kind: 'text-list'
    item: SchemaFormTextConstraints
    suggestions?: SchemaFormOption[]
    minItems?: number
    maxItems?: number
    uniqueItems: boolean
    default?: string[]
  }
  | SchemaFormFieldBase & {
    kind: 'resource'
    /** `single` submits one URI; `explicit` / `implicit` submit a URI array. */
    selection: 'single' | 'explicit' | 'implicit'
    options: SchemaFormResource[]
    minItems?: number
    maxItems?: number
    default?: string | string[]
  }

export type SchemaFormFieldKind = SchemaFormField['kind']

export type SchemaForm =
  | { supported: true; fields: SchemaFormField[] }
  /** `field` names the first property SuperOne cannot render, when there is one. */
  | { supported: false; field?: string; reason: string }

export type SchemaFormValue = string | number | boolean | string[]
export type SchemaFormValues = Record<string, SchemaFormValue | undefined>

export type SchemaFormErrorCode =
  | 'required' | 'type' | 'minLength' | 'maxLength' | 'pattern' | 'format'
  | 'minimum' | 'maximum' | 'integer' | 'minItems' | 'maxItems' | 'unique' | 'option'

export interface SchemaFormError {
  code: SchemaFormErrorCode
  /** The violated bound or format, for the message. */
  limit?: number | string
}

class Unsupported extends Error {}

type Rec = Record<string, unknown>

function isRecord(value: unknown): value is Rec {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optString(rec: Rec, key: string): string | undefined {
  const value = rec[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Unsupported(`"${key}" is not a string`)
  return value
}

function optNumber(rec: Rec, key: string): number | undefined {
  const value = rec[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Unsupported(`"${key}" is not a number`)
  return value
}

function optCount(rec: Rec, key: string): number | undefined {
  const value = optNumber(rec, key)
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Unsupported(`"${key}" is not a count`)
  return value
}

function optBoolean(rec: Rec, key: string): boolean | undefined {
  const value = rec[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Unsupported(`"${key}" is not a boolean`)
  return value
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Unsupported(`${what} is not a string array`)
  return value as string[]
}

/** MCP `Icon`. */
function parseImage(value: unknown): SchemaFormImage | undefined {
  if (!isRecord(value)) return undefined
  const src = safeMcpAppImage(value.src)
  if (!src) return undefined
  return { src, ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}) }
}

function parseOption(raw: unknown): SchemaFormOption {
  if (!isRecord(raw) || typeof raw.const !== 'string') throw new Unsupported('an option has no string "const"')
  const label = optString(raw, 'title') ?? raw.const
  const description = optString(raw, 'description')
  // `x-openai-preview` is the deprecated name of `x-openai-thumbnail`.
  const thumbnail = parseImage(raw['x-openai-thumbnail'] ?? raw['x-openai-preview'])
  return {
    value: raw.const,
    label,
    ...(description ? { description } : {}),
    ...(thumbnail ? { thumbnail } : {}),
  }
}

function parseOptions(value: unknown, what: string): SchemaFormOption[] {
  if (!Array.isArray(value) || value.length === 0) throw new Unsupported(`${what} has no options`)
  return value.map(parseOption)
}

function parseEnumOptions(rec: Rec): SchemaFormOption[] {
  const values = stringArray(rec.enum, '"enum"')
  if (values.length === 0) throw new Unsupported('"enum" is empty')
  const names = rec.enumNames === undefined ? undefined : stringArray(rec.enumNames, '"enumNames"')
  return values.map((value, i) => ({ value, label: names?.[i] ?? value }))
}

const TEXT_FORMATS = new Set<string>(['email', 'uri', 'date', 'date-time'])

function parseTextConstraints(rec: Rec): SchemaFormTextConstraints {
  const format = optString(rec, 'format')
  if (format !== undefined && !TEXT_FORMATS.has(format)) throw new Unsupported(`format "${format}"`)
  const pattern = optString(rec, 'pattern')
  if (pattern !== undefined) {
    try {
      new RegExp(pattern, 'u')
    } catch {
      throw new Unsupported('"pattern" is not a valid regular expression')
    }
  }
  const minLength = optCount(rec, 'minLength')
  const maxLength = optCount(rec, 'maxLength')
  return {
    ...(format ? { format: format as SchemaFormTextFormat } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  }
}

function parseSuggestions(rec: Rec): SchemaFormOption[] | undefined {
  const raw = rec['x-openai-suggestions']
  return raw === undefined ? undefined : parseOptions(raw, '"x-openai-suggestions"')
}

function parseResource(raw: unknown): SchemaFormResource {
  if (!isRecord(raw) || typeof raw.uri !== 'string' || typeof raw.name !== 'string') {
    throw new Unsupported('a resource option has no "uri" or "name"')
  }
  const meta = isRecord(raw._meta) ? raw._meta : {}
  const thumbnail = parseImage(meta['openai/thumbnail'])
  const preview = parsePreview(meta['openai/preview'])
  const title = optString(raw, 'title')
  const description = optString(raw, 'description')
  const mimeType = optString(raw, 'mimeType')
  const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : undefined
  return {
    uri: raw.uri,
    name: raw.name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(preview ? { preview } : {}),
  }
}

/** A malformed preview only loses the preview; the option stays selectable. */
function parsePreview(raw: unknown): SchemaFormPreviewTarget | undefined {
  const target = isRecord(raw) ? raw.target : undefined
  if (!isRecord(target)) return undefined
  if (target.type === 'mcp_app_tool' && typeof target.name === 'string' && target.name.trim()) {
    return { type: 'mcp_app_tool', name: target.name, arguments: isRecord(target.arguments) ? target.arguments : {} }
  }
  if (target.type === 'resource_link' && typeof target.uri === 'string' && typeof target.name === 'string') {
    return {
      type: 'resource_link',
      uri: target.uri,
      name: target.name,
      ...(typeof target.title === 'string' ? { title: target.title } : {}),
      ...(typeof target.mimeType === 'string' ? { mimeType: target.mimeType } : {}),
    }
  }
  return undefined
}

/**
 * User-added files and directories (`userOptions`) are not offered: they are
 * ignored on single and explicit selection, as ChatGPT web does, and implicit
 * selection — which always offers them — is unsupported.
 */
function parseResourceField(base: SchemaFormFieldBase, rec: Rec, input: Rec): SchemaFormField {
  if (input.type !== 'resource' && input.type !== 'file') throw new Unsupported(`input type "${String(input.type)}"`)
  if (!Array.isArray(input.options)) throw new Unsupported('resource input has no "options"')
  const options = input.options.map(parseResource)
  const multiple = rec.type === 'array'
  if (multiple) {
    const items = rec.items
    if (!isRecord(items) || items.type !== 'string' || items.format !== 'uri') throw new Unsupported('resource items are not URI strings')
  } else if (rec.type !== 'string' || rec.format !== 'uri') {
    throw new Unsupported('resource field is not a URI string')
  }
  if (!multiple && input.selection !== undefined) throw new Unsupported('selection mode on a single resource field')
  if (input.selection !== undefined && input.selection !== 'explicit' && input.selection !== 'implicit') {
    throw new Unsupported(`selection mode "${String(input.selection)}"`)
  }
  const selection = multiple ? (input.selection as 'explicit' | 'implicit' | undefined) ?? 'explicit' : 'single'
  if (input.userOptions !== undefined && !isRecord(input.userOptions)) throw new Unsupported('"userOptions" is not an object')
  if (selection === 'implicit') throw new Unsupported('implicit resource selection requires user-added resources')

  let defaultValue: string | string[] | undefined
  if (rec.default !== undefined) {
    defaultValue = multiple ? stringArray(rec.default, '"default"') : optString(rec, 'default')
    const defaults = Array.isArray(defaultValue) ? defaultValue : [defaultValue]
    if (defaults.some((uri) => !options.some((o) => o.uri === uri))) throw new Unsupported('a default is not a supplied resource')
  }
  const minItems = multiple ? optCount(rec, 'minItems') : undefined
  const maxItems = multiple ? optCount(rec, 'maxItems') : undefined
  return {
    ...base,
    kind: 'resource',
    selection,
    options,
    ...(minItems !== undefined ? { minItems } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  }
}

function parseField(name: string, raw: unknown, required: boolean): SchemaFormField {
  if (!isRecord(raw)) throw new Unsupported('not a schema object')
  const description = optString(raw, 'description')
  const base: SchemaFormFieldBase = {
    name,
    label: optString(raw, 'title') ?? name,
    ...(description ? { description } : {}),
    required,
  }
  if (raw['x-openai-input'] !== undefined) {
    if (!isRecord(raw['x-openai-input'])) throw new Unsupported('"x-openai-input" is not an object')
    return parseResourceField(base, raw, raw['x-openai-input'])
  }

  switch (raw.type) {
    case 'string': {
      if (raw.oneOf !== undefined) {
        const options = parseOptions(raw.oneOf, '"oneOf"')
        const def = optString(raw, 'default')
        if (def !== undefined && !options.some((o) => o.value === def)) throw new Unsupported('default is not an option')
        return { ...base, kind: 'select', options, ...(def !== undefined ? { default: def } : {}) }
      }
      if (raw.enum !== undefined) {
        const options = parseEnumOptions(raw)
        const def = optString(raw, 'default')
        if (def !== undefined && !options.some((o) => o.value === def)) throw new Unsupported('default is not an option')
        return { ...base, kind: 'select', options, ...(def !== undefined ? { default: def } : {}) }
      }
      if (raw.anyOf !== undefined) throw new Unsupported('"anyOf" on a string')
      const def = optString(raw, 'default')
      const suggestions = parseSuggestions(raw)
      return {
        ...base,
        kind: 'text',
        ...parseTextConstraints(raw),
        ...(suggestions ? { suggestions } : {}),
        ...(def !== undefined ? { default: def } : {}),
      }
    }
    case 'number':
    case 'integer': {
      const minimum = optNumber(raw, 'minimum')
      const maximum = optNumber(raw, 'maximum')
      const def = optNumber(raw, 'default')
      return {
        ...base,
        kind: 'number',
        integer: raw.type === 'integer',
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
        ...(def !== undefined ? { default: def } : {}),
      }
    }
    case 'boolean': {
      const def = optBoolean(raw, 'default')
      return { ...base, kind: 'boolean', ...(def !== undefined ? { default: def } : {}) }
    }
    case 'array': {
      const items = raw.items
      if (!isRecord(items)) throw new Unsupported('array without "items"')
      const minItems = optCount(raw, 'minItems')
      const maxItems = optCount(raw, 'maxItems')
      const def = raw.default === undefined ? undefined : stringArray(raw.default, '"default"')
      const counts = {
        ...(minItems !== undefined ? { minItems } : {}),
        ...(maxItems !== undefined ? { maxItems } : {}),
        ...(def !== undefined ? { default: def } : {}),
      }
      if (items.anyOf !== undefined || items.enum !== undefined) {
        if (items.anyOf !== undefined && items.enum !== undefined) throw new Unsupported('items with both "anyOf" and "enum"')
        if (items.enum !== undefined && items.type !== 'string') throw new Unsupported('enum items are not strings')
        const options = items.anyOf !== undefined ? parseOptions(items.anyOf, '"items.anyOf"') : parseEnumOptions(items)
        if (def?.some((v) => !options.some((o) => o.value === v))) throw new Unsupported('default is not an option')
        return { ...base, kind: 'multiselect', options, ...counts }
      }
      if (items.type !== 'string' || items.oneOf !== undefined) throw new Unsupported('array items are not plain strings')
      const suggestions = parseSuggestions(items)
      return {
        ...base,
        kind: 'text-list',
        item: parseTextConstraints(items),
        ...(suggestions ? { suggestions } : {}),
        uniqueItems: optBoolean(raw, 'uniqueItems') ?? false,
        ...counts,
      }
    }
    default:
      throw new Unsupported(`type "${String(raw.type)}"`)
  }
}

/** Parse a `requestedSchema`. An absent or empty schema is a form with no fields. */
export function parseSchemaForm(schema: unknown): SchemaForm {
  if (schema === undefined || schema === null) return { supported: true, fields: [] }
  if (!isRecord(schema) || (schema.type !== undefined && schema.type !== 'object')) {
    return { supported: false, reason: 'the schema is not an object' }
  }
  if (schema.properties === undefined) return { supported: true, fields: [] }
  if (!isRecord(schema.properties)) return { supported: false, reason: '"properties" is not an object' }
  let required: string[]
  try {
    required = schema.required === undefined ? [] : stringArray(schema.required, '"required"')
  } catch (err) {
    return { supported: false, reason: (err as Error).message }
  }
  const fields: SchemaFormField[] = []
  for (const [name, raw] of Object.entries(schema.properties)) {
    try {
      fields.push(parseField(name, raw, required.includes(name)))
    } catch (err) {
      if (err instanceof Unsupported) return { supported: false, field: name, reason: err.message }
      throw err
    }
  }
  return { supported: true, fields }
}

/** Starting answers: declared defaults, booleans off. */
export function initialSchemaFormValues(fields: readonly SchemaFormField[]): SchemaFormValues {
  const values: SchemaFormValues = {}
  for (const field of fields) {
    if (field.default !== undefined) {
      values[field.name] = Array.isArray(field.default) ? [...field.default] : field.default
    } else if (field.kind === 'boolean') {
      values[field.name] = false
    }
  }
  return values
}

function codePoints(value: string): number {
  return [...value].length
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URI = /^[a-z][a-z\d+.-]*:\S*$/i
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

function isValidDate(value: string): boolean {
  const m = DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

function matchesFormat(format: SchemaFormTextFormat, value: string): boolean {
  switch (format) {
    case 'email': return EMAIL.test(value)
    case 'uri': return URI.test(value)
    case 'date': return isValidDate(value)
    case 'date-time': {
      const m = DATE_TIME.exec(value)
      return Boolean(m && isValidDate(m[1]!) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 61)
    }
  }
}

function checkText(c: SchemaFormTextConstraints, value: string): SchemaFormError | null {
  if (c.minLength !== undefined && codePoints(value) < c.minLength) return { code: 'minLength', limit: c.minLength }
  if (c.maxLength !== undefined && codePoints(value) > c.maxLength) return { code: 'maxLength', limit: c.maxLength }
  if (c.format && !matchesFormat(c.format, value)) return { code: 'format', limit: c.format }
  if (c.pattern !== undefined && !new RegExp(c.pattern, 'u').test(value)) return { code: 'pattern', limit: c.pattern }
  return null
}

function checkCount(field: { minItems?: number; maxItems?: number }, count: number): SchemaFormError | null {
  if (field.minItems !== undefined && count < field.minItems) return { code: 'minItems', limit: field.minItems }
  if (field.maxItems !== undefined && count > field.maxItems) return { code: 'maxItems', limit: field.maxItems }
  return null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function checkField(field: SchemaFormField, value: SchemaFormValue): SchemaFormError | null {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? checkText(field, value) : { code: 'type' }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { code: 'type' }
      if (field.integer && !Number.isInteger(value)) return { code: 'integer' }
      if (field.minimum !== undefined && value < field.minimum) return { code: 'minimum', limit: field.minimum }
      if (field.maximum !== undefined && value > field.maximum) return { code: 'maximum', limit: field.maximum }
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : { code: 'type' }
    case 'select':
      if (typeof value !== 'string') return { code: 'type' }
      return field.options.some((o) => o.value === value) ? null : { code: 'option' }
    case 'multiselect':
      if (!isStringArray(value)) return { code: 'type' }
      if (value.some((v) => !field.options.some((o) => o.value === v))) return { code: 'option' }
      if (new Set(value).size !== value.length) return { code: 'unique' }
      return checkCount(field, value.length)
    case 'text-list': {
      if (!isStringArray(value)) return { code: 'type' }
      if (field.uniqueItems && new Set(value).size !== value.length) return { code: 'unique' }
      for (const item of value) {
        const error = checkText(field.item, item)
        if (error) return error
      }
      return checkCount(field, value.length)
    }
    case 'resource': {
      const uris = field.selection === 'single' ? [value] : value
      if (field.selection === 'single' ? typeof value !== 'string' : !isStringArray(value)) return { code: 'type' }
      // Without user-added resources, only supplied URIs may go back to the server.
      if ((uris as string[]).some((uri) => !field.options.some((o) => o.uri === uri))) return { code: 'option' }
      if (field.selection !== 'single' && new Set(uris as string[]).size !== (uris as string[]).length) return { code: 'unique' }
      return field.selection === 'single' ? null : checkCount(field, (uris as string[]).length)
    }
  }
}

/**
 * The value a field submits, or `undefined` when it is left out of `content`:
 * an empty optional string or array counts as unanswered.
 */
function submittedValue(field: SchemaFormField, value: SchemaFormValue | undefined): SchemaFormValue | undefined {
  if (value === undefined) return undefined
  if (field.required) return value
  if (value === '' || (Array.isArray(value) && value.length === 0)) return undefined
  return value
}

/** Per-field errors for the current answers; an empty object means submittable. */
export function validateSchemaForm(fields: readonly SchemaFormField[], values: SchemaFormValues): Record<string, SchemaFormError> {
  const errors: Record<string, SchemaFormError> = {}
  for (const field of fields) {
    const value = submittedValue(field, values[field.name])
    if (value === undefined || (field.required && value === '')) {
      if (field.required) errors[field.name] = { code: 'required' }
      continue
    }
    const error = checkField(field, value)
    if (error) errors[field.name] = error
  }
  return errors
}

/** The `content` of an `accept` result. Call after `validateSchemaForm` reports no errors. */
export function schemaFormContent(fields: readonly SchemaFormField[], values: SchemaFormValues): Record<string, SchemaFormValue> {
  const content: Record<string, SchemaFormValue> = {}
  for (const field of fields) {
    const value = submittedValue(field, values[field.name])
    if (value !== undefined) content[field.name] = value
  }
  return content
}

/**
 * The legacy flat field list read by phone builds that predate `schemaForm`.
 * Only forms expressible in that shape get one; anything richer shows those
 * builds a bare allow/deny.
 */
function legacyElicitationFields(fields: readonly SchemaFormField[]): ElicitationFormField[] | undefined {
  const legacy: ElicitationFormField[] = []
  for (const field of fields) {
    const base = { name: field.name, label: field.label, required: field.required, ...(field.description ? { description: field.description } : {}) }
    if (field.kind === 'text') legacy.push({ ...base, type: 'string' })
    else if (field.kind === 'number') legacy.push({ ...base, type: 'number' })
    else if (field.kind === 'boolean') legacy.push({ ...base, type: 'boolean' })
    else if (field.kind === 'select') legacy.push({ ...base, type: 'enum', enumOptions: field.options.map((o) => o.value) })
    else return undefined
  }
  return legacy
}

/** The form keys of an elicitation `PermissionRequest`; empty for a form without fields. */
export function elicitationFormRequest(schema: unknown): Pick<PermissionRequest, 'schemaForm' | 'elicitationForm'> {
  const form = parseSchemaForm(schema)
  if (form.supported && form.fields.length === 0) return {}
  const elicitationForm = form.supported ? legacyElicitationFields(form.fields) : undefined
  return { schemaForm: form, ...(elicitationForm ? { elicitationForm } : {}) }
}

/**
 * Check answers arriving from any client (desktop, an older phone) against the
 * form before they reach the server: only declared fields, valid values, and
 * resource URIs the server itself offered.
 */
export function acceptedElicitationContent(
  form: SchemaForm | undefined,
  answers: Record<string, unknown> | undefined,
): { ok: true; content: Record<string, SchemaFormValue> } | { ok: false; reason: string } {
  if (!form) return { ok: true, content: {} }
  if (!form.supported) return { ok: false, reason: `unsupported form: ${form.reason}` }
  const values = (answers ?? {}) as SchemaFormValues
  const errors = Object.entries(validateSchemaForm(form.fields, values))
  if (errors.length > 0) return { ok: false, reason: errors.map(([name, e]) => `${name}: ${e.code}`).join(', ') }
  return { ok: true, content: schemaFormContent(form.fields, values) }
}
