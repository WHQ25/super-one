/** Shared parsing for the human-readable ListAgents roster. */
/**
 * Shape of the `ListAgents` roster, recovered from the text the tool prints.
 *
 * `ListAgents` has no structured result — it returns a human-ish listing built by the
 * harness (`Subagents (1):` / `Peer sessions (2):` / `Other Claude sessions (3):`, then
 * one indented ` · `-separated row per agent). The harness owns that format and can add
 * a kind or a column at any time, so this parser reads *structure* (section, row,
 * fields) rather than a fixed column list, and every unknown fragment survives as text.
 *
 * Parsing is total: anything that does not look like a section falls out as a note and
 * a result that yields no rows at all is reported as unparsed, so the block can show the
 * raw text instead of an empty list.
 */

export type AgentGroupKind = 'subagents' | 'peers' | 'others' | 'unknown'

/** Coarse liveness, derived from the words the harness prints on the row. */
export type ListedAgentStatus = 'running' | 'waiting' | 'offline' | 'idle' | 'unknown'

export interface ListedAgent {
  /** The address `SendMessage` takes — id for subagents, session name for peers. */
  name: string
  /** Disambiguating suffix printed as `[205b72]`; only present when names collide. */
  ref?: string
  /** Remaining ` · ` fields minus the age, in printed order (agent type, kind, status). */
  descriptors: string[]
  status: ListedAgentStatus
  /** `started 3m ago` / `active 11m ago`, kept whole — the row's only time signal. */
  age?: string
}

export interface AgentGroup {
  kind: AgentGroupKind
  /** Section heading exactly as printed, without the count. */
  title: string
  /** Count from the heading. Can exceed `agents.length` when the harness truncates. */
  declaredCount?: number
  agents: ListedAgent[]
}

export interface ListAgentsInfo {
  groups: AgentGroup[]
  /** Rows actually listed, across every group. */
  total: number
  /** Non-section lines: `No reachable agents.`, truncation warnings, stray prose. */
  notes: string[]
  /** No agent was listed — either nobody is reachable, or nothing parsed. */
  empty: boolean
  /**
   * No section survived parsing. Whatever the tool said lives in `notes` / `raw`, and
   * the block must show that instead of an empty roster.
   */
  unstructured: boolean
  /** The result verbatim, so an unrecognized format is still readable. */
  raw: string
}

/** `Peer sessions (2):` — a heading is unindented, ends in `:`, and may carry a count. */
const HEADING = /^(\S.*?)(?:\s*\((\d+)\))?\s*:$/
/** Fields are joined with a middle dot, padded on both sides by the harness. */
const FIELD_SEPARATOR = /\s+·\s+/
/** `super-one-9c [205b72]` — the bracketed ref disambiguates two same-named rows. */
const NAME_WITH_REF = /^(.*?)\s*\[([^\][]+)\]$/
/** `started 3m ago`, `active 11m ago`, `says it was idle until 2m ago`. */
const AGE = /\bago$/

function groupKind(title: string): AgentGroupKind {
  const key = title.toLowerCase()
  if (key.startsWith('subagent')) return 'subagents'
  if (key.startsWith('peer')) return 'peers'
  if (key.startsWith('other')) return 'others'
  return 'unknown'
}

/**
 * Status words are matched against the whole row, not one column: the harness prints
 * liveness in different slots per kind (`running` for a subagent, `interactive` for a
 * peer, `waiting on a human` for a bridged session).
 */
function agentStatus(fields: string[]): ListedAgentStatus {
  const text = fields.join(' ').toLowerCase()
  if (text.includes('waiting on a human') || text.includes('requires_action')) return 'waiting'
  if (text.includes('offline')) return 'offline'
  if (/\brunning\b/.test(text)) return 'running'
  if (/\b(interactive|active|idle|waiting)\b/.test(text)) return 'idle'
  return 'unknown'
}

function parseRow(line: string): ListedAgent | null {
  const fields = line.split(FIELD_SEPARATOR).map((f) => f.trim()).filter(Boolean)
  if (fields.length === 0) return null

  const [head, ...rest] = fields
  const withRef = NAME_WITH_REF.exec(head)
  const name = (withRef ? withRef[1] : head).trim()
  // A row whose first field is only a bracketed ref still has an address worth showing.
  if (!name && !withRef) return null

  const ageIndex = rest.findIndex((field) => AGE.test(field))
  const age = ageIndex >= 0 ? rest[ageIndex] : undefined
  const descriptors = ageIndex >= 0 ? [...rest.slice(0, ageIndex), ...rest.slice(ageIndex + 1)] : rest

  return {
    name: name || (withRef ? withRef[2] : head),
    ref: withRef ? withRef[2] : undefined,
    descriptors,
    status: agentStatus(rest),
    age,
  }
}

export function parseListAgents(result: string | null | undefined): ListAgentsInfo {
  const text = (result ?? '').trim()
  const groups: AgentGroup[] = []
  const notes: string[] = []

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    const indented = /^\s/.test(raw)
    const heading = indented ? null : HEADING.exec(raw.trim())

    if (heading) {
      const title = heading[1].trim()
      groups.push({
        kind: groupKind(title),
        title,
        declaredCount: heading[2] ? Number(heading[2]) : undefined,
        agents: [],
      })
      continue
    }

    const group = groups[groups.length - 1]
    // An unindented line after a heading has left the list (a trailing warning, prose);
    // only indented rows belong to the section above them.
    const agent = indented && group ? parseRow(raw.trim()) : null
    if (agent) group.agents.push(agent)
    else notes.push(raw.trim())
  }

  const total = groups.reduce((sum, group) => sum + group.agents.length, 0)
  return {
    groups,
    total,
    notes,
    empty: total === 0,
    unstructured: groups.length === 0,
    raw: text,
  }
}

export interface AgentGroupCount {
  kind: AgentGroupKind
  title: string
  count: number
}

/**
 * The collapsed row's story: which kinds of agent are reachable, and how many.
 *
 * Declared count wins over listed rows so a truncated section still reports the real
 * size — the header is a tally, not an index into what expand happens to show.
 */
export function agentGroupCounts(info: ListAgentsInfo): AgentGroupCount[] {
  return info.groups
    .map((group) => ({
      kind: group.kind,
      title: group.title,
      count: group.declaredCount ?? group.agents.length,
    }))
    .filter((group) => group.count > 0)
}
