import type { ContentBlock, SlashCommandInfo } from '@superone/shared/agent-types'
import { fuzzyMatch } from '@/lib/fuzzy-match'
import { collectSessionWorkflows } from './collect-session-workflows'
import { parseWorkflowInput, parseWorkflowLaunch } from './workflow-utils'

export const WORKFLOW_MANAGE_OPS = ['pause', 'resume', 'stop', 'save'] as const
export type WorkflowManageOp = (typeof WORKFLOW_MANAGE_OPS)[number]

export type WorkflowSuggestKind = 'op' | 'workflow' | 'run'

export interface WorkflowCatalogEntry {
  name: string
  description: string
  source?: string
  /** From available_commands input.hint, e.g. `<args>`. */
  argumentHint?: string
  /** Absolute or relative path to `.rhai` source (for parsing real args). */
  path?: string
}

export interface WorkflowRunEntry {
  name: string
  description: string
  /** running | complete | unknown */
  status?: 'running' | 'complete' | 'unknown'
}

export interface WorkflowSuggestItem {
  id: string
  kind: WorkflowSuggestKind
  name: string
  description: string
  source?: string
  argumentHint?: string
  matchIndices: number[]
  score: number
  /** Optional status chip for session runs. */
  status?: WorkflowRunEntry['status']
}

export interface WorkflowSlashPhase {
  /** Text before the token currently being edited. */
  prefix: string
  /** Incomplete token under the cursor. */
  partial: string
  /** First token is a completed manage op → suggest session run names. */
  afterOp: WorkflowManageOp | null
  /**
   * First token is a non-op name (launch path). User can add JSON args or a
   * name-first manage op (`review-changes pause`).
   */
  afterName: string | null
  /**
   * Fully committed manage command, or freeform args past autocomplete.
   * Popup may still show an args tip via `resolveWorkflowArgsTip`.
   */
  done: boolean
}

export interface WorkflowArgsTip {
  name: string
  description: string
  argumentHint: string
  source?: string
  /** Example line the user can send as-is or edit. */
  exampleLine: string
  whenToUse?: string
  /** Parsed from the workflow script when available. */
  args?: Array<{ name: string; description?: string; required?: boolean }>
  exampleJson?: string
}

const OP_SET = new Set<string>(WORKFLOW_MANAGE_OPS)

export function isWorkflowManageOp(s: string): s is WorkflowManageOp {
  return OP_SET.has(s.toLowerCase())
}

/**
 * Parse `/workflow` args for autocomplete.
 * - first token: ops + catalog names
 * - after a completed op: session run names
 * - after a non-op name: args tip + optional name-first manage ops
 */
export function parseWorkflowSlashPhase(argsText: string): WorkflowSlashPhase {
  const trailingSpace = argsText.length > 0 && /\s$/.test(argsText)
  const trimmedStart = argsText.replace(/^\s+/, '')
  const tokens = trimmedStart.length === 0 ? [] : trimmedStart.trimEnd().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return { prefix: '', partial: '', afterOp: null, afterName: null, done: false }
  }

  const first = tokens[0]!
  const firstIsOp = isWorkflowManageOp(first)

  if (tokens.length === 1 && !trailingSpace) {
    return { prefix: '', partial: first, afterOp: null, afterName: null, done: false }
  }

  if (tokens.length === 1 && trailingSpace) {
    if (firstIsOp) {
      return {
        prefix: `${first} `,
        partial: '',
        afterOp: first.toLowerCase() as WorkflowManageOp,
        afterName: null,
        done: false,
      }
    }
    // Launch name committed — stay in afterName for args tip / name-first ops.
    return {
      prefix: `${first} `,
      partial: '',
      afterOp: null,
      afterName: first,
      done: false,
    }
  }

  // tokens.length >= 2
  if (firstIsOp) {
    if (tokens.length === 2 && !trailingSpace) {
      return {
        prefix: `${first} `,
        partial: tokens[1]!,
        afterOp: first.toLowerCase() as WorkflowManageOp,
        afterName: null,
        done: false,
      }
    }
    // op + name (+ more) complete
    return { prefix: argsText, partial: '', afterOp: null, afterName: null, done: true }
  }

  // name-first: `review-changes pause` or launch with args
  const second = tokens[1]!
  if (tokens.length === 2 && !trailingSpace) {
    if (isWorkflowManageOp(second)) {
      // Completing name-first manage — no further name suggestions.
      return { prefix: `${first} `, partial: second, afterOp: null, afterName: first, done: false }
    }
    // Typing freeform args after name (e.g. JSON) — tip only.
    return {
      prefix: `${first} `,
      partial: tokens.slice(1).join(' '),
      afterOp: null,
      afterName: first,
      done: false,
    }
  }

  if (tokens.length === 2 && trailingSpace && isWorkflowManageOp(second)) {
    return { prefix: argsText, partial: '', afterOp: null, afterName: null, done: true }
  }

  // name + multi-token args (JSON with spaces rare) or finished manage
  return {
    prefix: `${first} `,
    partial: tokens.slice(1).join(' '),
    afterOp: null,
    afterName: first,
    done: tokens.length > 2 && isWorkflowManageOp(second),
  }
}

export function catalogWorkflows(commands: SlashCommandInfo[]): WorkflowCatalogEntry[] {
  const out: WorkflowCatalogEntry[] = []
  const seen = new Set<string>()
  for (const c of commands) {
    if (!c.isWorkflow && !/^Workflow:\s/i.test(c.description) && !c.workflowPath) continue
    const name = c.name.replace(/^\//, '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const description = c.description.replace(/^Workflow:\s*/i, '').trim() || c.description
    out.push({
      name,
      description,
      source: c.workflowSource,
      argumentHint: c.argumentHint?.trim() || undefined,
      path: c.workflowPath,
    })
  }
  return out
}

export function sessionRunNames(
  messages: Array<{ content: ContentBlock[] }>,
  taskProgress?: Record<string, { completed?: boolean; description?: string; taskId?: string }>,
): WorkflowRunEntry[] {
  const out: WorkflowRunEntry[] = []
  const seen = new Set<string>()
  for (const item of collectSessionWorkflows(messages)) {
    const meta = parseWorkflowInput(item.toolBlock.input)
    const launch = parseWorkflowLaunch(
      item.resultBlock?.type === 'tool_result' ? item.resultBlock.summary : undefined,
    )
    const name = (meta.name || launch.runId || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)

    const progress =
      taskProgress?.[item.id]
      ?? (launch.runId ? taskProgress?.[launch.runId] : undefined)
      ?? (launch.taskId
        ? Object.values(taskProgress ?? {}).find((e) => e.taskId === launch.taskId)
        : undefined)

    let status: WorkflowRunEntry['status'] = 'unknown'
    if (progress) {
      status = progress.completed === true ? 'complete' : 'running'
    } else if (item.toolBlock.taskResultText) {
      status = 'complete'
    } else if (item.resultBlock) {
      // Early launch ack — often still running for Grok.
      status = 'running'
    }

    out.push({
      name,
      description: meta.description
        || progress?.description
        || launch.runId
        || 'Session run',
      status,
    })
  }
  return out
}

function rank(
  partial: string,
  items: Array<{
    name: string
    description: string
    source?: string
    kind: WorkflowSuggestKind
    argumentHint?: string
    status?: WorkflowRunEntry['status']
  }>,
): WorkflowSuggestItem[] {
  const q = partial.toLowerCase()
  const ranked: WorkflowSuggestItem[] = []
  for (const item of items) {
    if (!q) {
      ranked.push({
        id: `${item.kind}:${item.name}`,
        kind: item.kind,
        name: item.name,
        description: item.description,
        source: item.source,
        argumentHint: item.argumentHint,
        matchIndices: [],
        score: 0,
        status: item.status,
      })
      continue
    }
    const nameMatch = fuzzyMatch(q, item.name)
    // Description match only for launch/run rows — ops like "paused" in resume's
    // blurb would false-positive on "pa" → pause+resume+….
    const descMatch =
      item.kind !== 'op' && item.description
        ? fuzzyMatch(q, item.description)
        : { match: false, score: 0, indices: [] as number[] }
    if (!nameMatch.match && !descMatch.match) continue
    // Prefer name hits; description-only matches still surface with lower score.
    const score = nameMatch.match
      ? nameMatch.score + 20
      : descMatch.score
    ranked.push({
      id: `${item.kind}:${item.name}`,
      kind: item.kind,
      name: item.name,
      description: item.description,
      source: item.source,
      argumentHint: item.argumentHint,
      matchIndices: nameMatch.match ? nameMatch.indices : [],
      score,
      status: item.status,
    })
  }
  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

const OP_DESCRIPTIONS: Record<WorkflowManageOp, string> = {
  pause: 'Pause a running workflow',
  resume: 'Resume a paused workflow',
  stop: 'Stop a workflow run',
  save: 'Save the run script to the project',
}

function looksLikeArgs(partial: string): boolean {
  const t = partial.trimStart()
  if (!t) return false
  // JSON / flags / freeform — not a manage op in progress.
  if (t.startsWith('{') || t.startsWith('[') || t.startsWith('-')) return true
  if (isWorkflowManageOp(t) || WORKFLOW_MANAGE_OPS.some((op) => op.startsWith(t.toLowerCase()))) {
    return false
  }
  return true
}

export function buildWorkflowSuggestItems(
  phase: WorkflowSlashPhase,
  options: {
    catalog: WorkflowCatalogEntry[]
    runs: WorkflowRunEntry[]
  },
): WorkflowSuggestItem[] {
  if (phase.done) return []

  // After manage op: only session runs.
  if (phase.afterOp) {
    return rank(
      phase.partial,
      options.runs.map((r) => ({
        kind: 'run' as const,
        name: r.name,
        description: r.description,
        source: 'session',
        status: r.status,
      })),
    )
  }

  // After launch name: only the args tip (no manage list — use `/workflow pause …` form).
  if (phase.afterName) {
    return []
  }

  // First token: ops + catalog (+ highlight session runs that share a catalog name via status? skip)
  const ops = WORKFLOW_MANAGE_OPS.map((op) => ({
    kind: 'op' as const,
    name: op,
    description: OP_DESCRIPTIONS[op],
    source: 'manage',
  }))
  const workflows = options.catalog.map((w) => ({
    kind: 'workflow' as const,
    name: w.name,
    description: w.description,
    source: w.source,
    argumentHint: w.argumentHint,
  }))
  // Also surface session-only runs (not in catalog) as first-token candidates for manage.
  const catalogNames = new Set(options.catalog.map((c) => c.name))
  const sessionOnly = options.runs
    .filter((r) => !catalogNames.has(r.name))
    .map((r) => ({
      kind: 'run' as const,
      name: r.name,
      description: r.description,
      source: 'session',
      status: r.status,
    }))

  if (!phase.partial) {
    return rank('', [...ops, ...workflows, ...sessionOnly]).sort((a, b) => {
      const order = (k: WorkflowSuggestKind) => (k === 'op' ? 0 : k === 'workflow' ? 1 : 2)
      if (a.kind !== b.kind) return order(a.kind) - order(b.kind)
      if (a.kind === 'op') {
        return WORKFLOW_MANAGE_OPS.indexOf(a.name as WorkflowManageOp)
          - WORKFLOW_MANAGE_OPS.indexOf(b.name as WorkflowManageOp)
      }
      return a.name.localeCompare(b.name)
    })
  }
  return rank(phase.partial, [...ops, ...workflows, ...sessionOnly])
}

/** Contextual args tip when the user has committed a launch name. */
export function resolveWorkflowArgsTip(
  phase: WorkflowSlashPhase,
  catalog: WorkflowCatalogEntry[],
  scriptHints?: {
    whenToUse?: string
    args?: Array<{ name: string; description?: string; required?: boolean }>
    exampleJson?: string
  } | null,
): WorkflowArgsTip | null {
  if (!phase.afterName || phase.afterOp || phase.done) return null

  const partial = phase.partial.trim()
  // Typing a name-first manage op — the ops list is enough; hide the args tip.
  if (partial && !looksLikeArgs(partial)) {
    const p = partial.toLowerCase()
    if (isWorkflowManageOp(p) || WORKFLOW_MANAGE_OPS.some((op) => op.startsWith(p))) {
      return null
    }
  }

  const entry = catalog.find((c) => c.name === phase.afterName)
  const description = entry?.description || 'Launch this workflow'
  const args = scriptHints?.args ?? []
  const exampleJson = scriptHints?.exampleJson
  const hintFromArgs = args.length > 0
    ? args.map((a) => a.name).join(' · ')
    : (entry?.argumentHint?.trim() || '<args>')
  const exampleLine = exampleJson && exampleJson !== '{}'
    ? `/workflow ${phase.afterName} ${exampleJson} `
    : `/workflow ${phase.afterName} `

  return {
    name: phase.afterName,
    description,
    argumentHint: hintFromArgs,
    source: entry?.source,
    exampleLine,
    whenToUse: scriptHints?.whenToUse,
    args,
    exampleJson,
  }
}

/** Group items for sectioned popup rendering (preserves order within groups). */
export function groupWorkflowSuggestItems(items: WorkflowSuggestItem[]): Array<{
  key: 'op' | 'workflow' | 'run'
  label: string
  items: WorkflowSuggestItem[]
}> {
  const ops = items.filter((i) => i.kind === 'op')
  const workflows = items.filter((i) => i.kind === 'workflow')
  const runs = items.filter((i) => i.kind === 'run')
  const groups: Array<{ key: 'op' | 'workflow' | 'run'; label: string; items: WorkflowSuggestItem[] }> = []
  if (ops.length) groups.push({ key: 'op', label: 'Manage', items: ops })
  if (workflows.length) groups.push({ key: 'workflow', label: 'Launch', items: workflows })
  if (runs.length) groups.push({ key: 'run', label: 'Session runs', items: runs })
  return groups
}

/** Apply a suggestion into the full first-line command text. */
export function applyWorkflowSuggestion(
  phase: WorkflowSlashPhase,
  item: WorkflowSuggestItem,
): string {
  if (phase.afterName && item.kind === 'op') {
    // name-first manage: /workflow review-changes pause
    return `/workflow ${phase.afterName} ${item.name} `
  }
  if (item.kind === 'op') {
    return `/workflow ${item.name} `
  }
  if (phase.afterOp) {
    return `/workflow ${phase.afterOp} ${item.name} `
  }
  return `/workflow ${item.name} `
}
