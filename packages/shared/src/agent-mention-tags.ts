/**
 * `@codex` / `@claude` / `@grok` — mentioning a launchable agent in the composer.
 *
 * What the user calls "a run configuration" is a `session_providers` row, and
 * `session_collab_request({ agentId })` already takes that row's id. So a
 * mention carries exactly one thing: a **ref** to that row. Model, effort,
 * permission mode and everything else stay behind the row's `config_json`,
 * which is what keeps this extensible — the day user-defined run
 * configurations ship, they become mentionable with no protocol change, and
 * renaming one does not invalidate refs already stored in old messages.
 *
 * ACP is the single exception: one `acp-base` provider hosts several agents
 * (Grok, …), told apart by a secondary `acpAgentId`. That is why a ref is a
 * short encoded string rather than a bare id — the exception is contained here.
 */

import type { AgentMentionTarget, HarnessId } from './agent-types'
import { resolveHarnessBrandKey } from './harness/acp-brand'

/** Identity of a launchable agent: a provider row, plus the ACP agent when relevant. */
export interface AgentMentionRef {
  /** `session_providers.id` — passed verbatim as `session_collab_request.agentId`. */
  providerId: string
  /** ACP protocol agent id (e.g. `grok-build`). Only set when the provider is ACP. */
  acpAgentId?: string
}

const REF_SEPARATOR = ':'

/** `codex-base` | `acp-base:grok-build` */
export function encodeAgentRef(ref: AgentMentionRef): string {
  const providerId = ref.providerId.trim()
  const acpAgentId = ref.acpAgentId?.trim()
  return acpAgentId ? `${providerId}${REF_SEPARATOR}${acpAgentId}` : providerId
}

/** Inverse of `encodeAgentRef`. Returns null for empty/garbage input. */
export function decodeAgentRef(raw: string): AgentMentionRef | null {
  const value = raw.trim()
  if (!value) return null
  const sepAt = value.indexOf(REF_SEPARATOR)
  if (sepAt < 0) return { providerId: value }
  const providerId = value.slice(0, sepAt).trim()
  const acpAgentId = value.slice(sepAt + 1).trim()
  if (!providerId) return null
  return acpAgentId ? { providerId, acpAgentId } : { providerId }
}

/**
 * Brand identity of a stored ref, for rendering a chip in an old message.
 *
 * Provider ids are always minted as `<harnessId>-<suffix>` (`codex-base`,
 * `codex-<uuid>`), so the prefix survives in the tag and we never have to
 * freeze a brand key into the message — a re-branded harness re-renders.
 */
export function brandKeyForAgentRef(ref: string): string {
  const decoded = decodeAgentRef(ref)
  if (!decoded) return 'claude'
  const harnessId = decoded.providerId.split('-')[0] ?? ''
  return resolveHarnessBrandKey(harnessId, decoded.acpAgentId)
}

// --- Slugs: what the user actually types after `@` ---------------------------

export interface AgentMentionSlugSpec {
  /** Primary `@` keyword. */
  slug: string
  /** Extra keywords that match in the popup but are never displayed. */
  aliases: readonly string[]
  /** English fallback label; the UI prefers its localized harness label. */
  displayName: string
}

/**
 * Keyed by `resolveHarnessBrandKey()` output rather than by harness id, so an
 * ACP agent nobody has hardcoded still resolves through `slugForBrandKey`.
 */
export const AGENT_MENTION_SLUGS: Readonly<Record<string, AgentMentionSlugSpec>> = {
  claude: { slug: 'claude', aliases: ['cc', 'claude-code'], displayName: 'Claude' },
  codex: { slug: 'codex', aliases: ['gpt', 'openai'], displayName: 'Codex' },
  'acp-grok': { slug: 'grok', aliases: ['xai', 'acp'], displayName: 'Grok' },
  opencode: { slug: 'opencode', aliases: ['oc'], displayName: 'OpenCode' },
  'acp-opencode': { slug: 'opencode', aliases: ['oc', 'acp'], displayName: 'OpenCode' },
  cursor: { slug: 'cursor', aliases: [], displayName: 'Cursor' },
  dsh: { slug: 'deepseek', aliases: ['dsh', 'ds'], displayName: 'DeepSeek' },
}

/** Lowercase, hyphenated, `@`-safe. Empty string when nothing survives. */
export function slugifyAgentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Slug + aliases for a brand key, falling back to a derived slug for unknown ACP agents. */
export function slugForBrandKey(brandKey: string, fallbackName: string): AgentMentionSlugSpec {
  const known = AGENT_MENTION_SLUGS[brandKey]
  if (known) return known
  const derived = slugifyAgentName(brandKey.replace(/^acp-/, '')) || slugifyAgentName(fallbackName)
  return { slug: derived || 'agent', aliases: [], displayName: fallbackName || brandKey }
}

/**
 * Make slugs unique in place (`codex`, `codex-2`, …). Base rows are listed
 * first by the caller, so a user-defined run configuration named "Codex" is the
 * one that gets suffixed — the built-in keeps the obvious keyword.
 */
export function dedupeAgentSlugs<T extends { slug: string }>(items: T[]): T[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const count = seen.get(item.slug) ?? 0
    seen.set(item.slug, count + 1)
    return count === 0 ? item : { ...item, slug: `${item.slug}-${count + 1}` }
  })
}

// --- Building the popup list -------------------------------------------------

/** A provider row, from either the desktop DB or a remote node. */
export interface AgentMentionSource {
  providerId: string
  harnessId: HarnessId
  /** `session_providers.name` — "Codex (Base)" for base rows, user text otherwise. */
  name: string
  isBase: boolean
  /** Resolved ACP agent; falls back to nothing when the caller cannot resolve it. */
  acpAgentId?: string | null
}

/**
 * Turn provider rows into `@` targets. Shared so the local path (desktop DB)
 * and the remote path (node RPC) cannot drift into two different lists.
 *
 * Callers must pass rows already filtered to usable harnesses, base rows first.
 */
export function buildAgentMentionTargets(
  sources: readonly AgentMentionSource[],
): AgentMentionTarget[] {
  const targets = sources.map((source) => {
    const acpAgentId = source.acpAgentId?.trim() || undefined
    const brandKey = resolveHarnessBrandKey(source.harnessId, acpAgentId)
    const spec = slugForBrandKey(brandKey, source.name)
    // A base row IS the harness, and "Codex (Base)" reads badly as a chip; a
    // user-defined run configuration is shown under the name the user gave it.
    return {
      ref: encodeAgentRef({ providerId: source.providerId, ...(acpAgentId ? { acpAgentId } : {}) }),
      providerId: source.providerId,
      harnessId: source.harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      slug: source.isBase ? spec.slug : (slugifyAgentName(source.name) || spec.slug),
      aliases: [...spec.aliases],
      displayName: source.isBase ? spec.displayName : source.name,
      brandKey,
      isBase: source.isBase,
    }
  })
  return dedupeAgentSlugs(targets)
}

// --- Serialized tags ---------------------------------------------------------

export const AGENT_TAG_REGEX =
  /<superone-agent>\s*<name>([\s\S]*?)<\/name>\s*<ref>([\s\S]*?)<\/ref>\s*<\/superone-agent>/g

export const AGENT_REMINDER_REGEX =
  /\n*<superone-agent-reminder>[\s\S]*?<\/superone-agent-reminder>\n*/g

export function wrapAgentMention(ref: string, displayName: string): string {
  const name = displayName.trim() || ref
  return `<superone-agent><name>${name}</name><ref>${ref}</ref></superone-agent>`
}

export function replaceAgentTagsWithMention(text: string): string {
  return text
    .replace(AGENT_REMINDER_REGEX, '')
    .replace(AGENT_TAG_REGEX, (_full, name) => `@${String(name).trim()}`)
}

export function stripAgentMarkup(text: string): string {
  return replaceAgentTagsWithMention(text).replace(/\s+/g, ' ').trim()
}

/**
 * The prompt-side payload. The whole point of `@codex` is that the agent id is
 * already decided, so this block exists to stop the model from re-deriving it
 * via `session_collab_list_agents` and to pin the collaboration shape.
 */
export function formatAgentMentionReminder(
  targets: ReadonlyArray<{ displayName: string; providerId: string }>,
): string {
  if (targets.length === 0) return ''
  const lines = [
    'The user @-mentioned these agents to collaborate with. Their agent ids are given below —'
    + ' do NOT call session_collab_list_agents, and do NOT substitute a different agent.',
  ]
  const seen = new Set<string>()
  for (const target of targets) {
    if (seen.has(target.providerId)) continue
    seen.add(target.providerId)
    lines.push(`- "${target.displayName}" → agentId "${target.providerId}"`)
  }
  lines.push(
    '',
    'Launch each of them with session_collab_request({ launches: [{ mode: "spawn", agentId, name, role, summary, task }] }),',
    'then session_collab_start, then session_collab_send / session_collab_retrieve to work with them.',
    'Use mode "handoff" instead only when the user wants to hand the work over one-way and never hear back.',
    'The user still approves the launch, so request the most autonomous permission mode the task needs.',
  )
  return `\n\n<superone-agent-reminder>\n${lines.join('\n')}\n</superone-agent-reminder>`
}
