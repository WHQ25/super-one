/**
 * Open Knowledge Format (OKF v0.2) concept documents for interaction memory.
 *
 * Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 * A note is Markdown with YAML frontmatter. `type` is the only required key;
 * provenance (`sources`), trust (`generated`, `verified`), and lifecycle
 * (`status`, `stale_after`) are optional families. Unknown keys round-trip.
 */
import { parse, stringify } from 'yaml'
import { MEMORY_STATUSES, type MemorySource, type MemoryStatus } from '@superone/shared/browser-memory'

export const OKF_VERSION = '0.2'
export const NOTE_TYPE = 'Playbook'
/** Actor for notes written before provenance was recorded (legacy `version: 1` files). */
export const LEGACY_ACTOR = 'superone/agent'
/** OKF reserves these basenames at every level; they are never topics. */
export const RESERVED_NAMES = new Set(['index', 'log'])
const SOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/

export interface Actor { by: string; at: string }

export interface NoteMeta {
  title: string
  description: string
  resource: string
  status: MemoryStatus
  generated: Actor
  verified: Actor[]
  sources: MemorySource[]
  staleAfter?: string
  /** Producer-defined keys we do not interpret (including a foreign `type`); preserved on rewrite. */
  extra: Record<string, unknown>
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
const KNOWN = new Set(['title', 'description', 'resource', 'status', 'generated', 'verified', 'sources', 'stale_after', 'version', 'summary', 'updatedAt', 'archived', 'source', 'verifiedAt'])

export function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
export function text(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}: provide non-empty text within the storage limit.`)
}
function actor(value: unknown, name: string): Actor {
  const v = value as Partial<Actor> | null
  if (!v || typeof v !== 'object' || typeof v.by !== 'string' || !v.by.trim() || !isDateTime(v.at)) throw new Error(`Invalid ${name} metadata`)
  return { by: v.by, at: v.at }
}
export function validateSources(value: unknown): MemorySource[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid sources: provide up to 20 entries.')
  return value.map(entry => {
    const e = entry as Partial<MemorySource> | null
    if (!e || typeof e !== 'object') throw new Error('Invalid sources entry.')
    text(e.resource, 'sources[].resource', 1000)
    if (e.id !== undefined && (typeof e.id !== 'string' || !SOURCE_ID.test(e.id))) throw new Error('Invalid sources[].id: use a lowercase key.')
    if (e.title !== undefined) text(e.title, 'sources[].title', 200)
    return { resource: e.resource, ...(e.id !== undefined ? { id: e.id } : {}), ...(e.title !== undefined ? { title: e.title } : {}) }
  })
}
export function validateStatus(value: unknown): MemoryStatus {
  if (!(MEMORY_STATUSES as readonly unknown[]).includes(value)) throw new Error(`Invalid status: use ${MEMORY_STATUSES.join(', ')}.`)
  return value as MemoryStatus
}

/** Parse a note file. Accepts OKF and the pre-OKF `version: 1` layout, which is migrated on the next write. */
export function parseNote(raw: string, fallback: { title: string; resource: string }): { meta: NoteMeta; content: string } {
  const match = FRONTMATTER.exec(raw)
  if (!match) throw new Error('Missing Markdown metadata')
  const data = parse(match[1]!, { maxAliasCount: 0 }) as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Markdown metadata')
  const content = match[2]!
  const extra = Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN.has(key)))
  if (data.version === 1) return { meta: legacyMeta(data, fallback, extra), content }
  if (typeof data.type !== 'string' || !data.type.trim()) throw new Error('Invalid Markdown metadata')
  text(data.description, 'description', 500)
  const title = data.title === undefined ? fallback.title : (text(data.title, 'title', 200), data.title)
  const generated = data.generated === undefined ? { by: LEGACY_ACTOR, at: new Date(0).toISOString() } : actor(data.generated, 'generated')
  const verifiedRaw = data.verified === undefined ? [] : Array.isArray(data.verified) ? data.verified : [data.verified]
  const verified = verifiedRaw.map(v => actor(v, 'verified'))
  const status = data.status === undefined ? 'stable' : validateStatus(data.status)
  const sources = data.sources === undefined ? [] : validateSources(data.sources)
  if (data.stale_after !== undefined && !isDateTime(data.stale_after)) throw new Error('Invalid stale_after metadata')
  return { meta: { title, description: data.description, resource: typeof data.resource === 'string' ? data.resource : fallback.resource, status, generated, verified, sources,
    ...(data.stale_after !== undefined ? { staleAfter: data.stale_after } : {}), extra }, content }
}

function legacyMeta(data: Record<string, unknown>, fallback: { title: string; resource: string }, extra: Record<string, unknown>): NoteMeta {
  if (typeof data.archived !== 'boolean' || !isDateTime(data.updatedAt)) throw new Error('Invalid Markdown metadata')
  text(data.summary, 'summary', 500)
  if (data.source !== undefined) text(data.source, 'source', 1000)
  if (data.verifiedAt !== undefined && !isDateTime(data.verifiedAt)) throw new Error('Invalid verifiedAt metadata')
  return { title: fallback.title, description: data.summary, resource: fallback.resource, status: data.archived ? 'deprecated' : 'stable',
    generated: { by: LEGACY_ACTOR, at: data.updatedAt }, verified: data.verifiedAt !== undefined ? [{ by: LEGACY_ACTOR, at: data.verifiedAt }] : [],
    sources: data.source !== undefined ? [{ resource: data.source }] : [], extra }
}

export function serializeNote(meta: NoteMeta, content: string): string {
  const frontmatter: Record<string, unknown> = {
    type: NOTE_TYPE, ...meta.extra, title: meta.title, description: meta.description, resource: meta.resource, status: meta.status,
    generated: meta.generated,
    ...(meta.verified.length ? { verified: meta.verified } : {}),
    ...(meta.sources.length ? { sources: meta.sources } : {}),
    ...(meta.staleAfter ? { stale_after: meta.staleAfter } : {}),
  }
  return `---\n${stringify(frontmatter)}---\n${content}`
}

/** Latest verification instant, the OKF notion of "how recently". */
export function latestVerifiedAt(verified: Actor[]): string | undefined {
  return verified.reduce<string | undefined>((latest, v) => (!latest || v.at > latest ? v.at : latest), undefined)
}

export interface IndexItem { name: string; href: string; description: string; deprecated?: boolean }

/** OKF §8 directory listing for progressive disclosure; consumers may also synthesize it. */
export function renderIndex(heading: string, items: IndexItem[], opts?: { root?: boolean }): string {
  const line = (item: IndexItem) => `* [${item.name}](${item.href}) - ${item.description}`
  const live = items.filter(item => !item.deprecated)
  const deprecated = items.filter(item => item.deprecated)
  const sections = [`# ${heading}\n\n${live.length ? live.map(line).join('\n') : '_No entries yet._'}`]
  if (deprecated.length) sections.push(`# Deprecated\n\n${deprecated.map(line).join('\n')}`)
  return `${opts?.root ? `---\nokf_version: "${OKF_VERSION}"\n---\n` : ''}${sections.join('\n\n')}\n`
}
