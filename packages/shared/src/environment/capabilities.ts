import type { HarnessId } from '../session-types'

/**
 * Negotiated environment capabilities — not inferred from version strings.
 * Unknown flags on either side must be ignored; absence means unsupported.
 */

export interface EnvironmentCapabilities {
  sessions: boolean
  /** Harness IDs this environment can host. */
  harnessIds: HarnessId[]
  terminal: boolean
  workspaceFs: boolean
  git: boolean
  worktrees: boolean
  mcp: boolean
  fileTransfer: boolean
  collaboration: boolean
  nodeAdmin: boolean
  /**
   * After cold node restart, Sessions remain usable and later turns may resume
   * from durable provider metadata when the Harness supports it.
   */
  coldSessionResume: boolean
  /** In-flight turn reattach across graceful node restart (provider-specific). */
  turnReattach: boolean
  /**
   * Host Action channel v1: durable poll/claim/respond for controller-side tools
   * (browser automation, computer use). Session-scoped grants (e.g. browser.read)
   * are stamped on session.create separately.
   */
  hostActionV1: boolean
  /**
   * Environment-scoped draft store (draft.list/upsert/delete). Absent on nodes
   * predating the feature — their sidebar simply shows no drafts group.
   */
  drafts: boolean
}

export const LOCAL_ENVIRONMENT_CAPABILITIES: EnvironmentCapabilities = {
  sessions: true,
  harnessIds: ['claude', 'codex', 'acp', 'opencode'],
  terminal: true,
  workspaceFs: true,
  git: true,
  worktrees: true,
  mcp: true,
  fileTransfer: true,
  collaboration: true,
  nodeAdmin: false,
  coldSessionResume: true,
  turnReattach: false,
  hostActionV1: true,
  drafts: true,
}

/** Baseline node capabilities; Phase 2 enables workspaceFs/git/worktrees at runtime. */
export const PHASE1_NODE_CAPABILITIES: EnvironmentCapabilities = {
  sessions: false,
  harnessIds: [],
  terminal: true,
  workspaceFs: true,
  git: true,
  worktrees: true,
  mcp: false,
  fileTransfer: false,
  collaboration: false,
  nodeAdmin: true,
  coldSessionResume: false,
  turnReattach: false,
  hostActionV1: true,
  drafts: true,
}

/**
 * Intersect two capability sets for negotiation.
 * Boolean flags AND; harnessIds is the intersection of both lists.
 */
export function intersectCapabilities(
  a: EnvironmentCapabilities,
  b: EnvironmentCapabilities,
): EnvironmentCapabilities {
  const harnessSet = new Set(b.harnessIds)
  return {
    sessions: a.sessions && b.sessions,
    harnessIds: a.harnessIds.filter((id) => harnessSet.has(id)),
    terminal: a.terminal && b.terminal,
    workspaceFs: a.workspaceFs && b.workspaceFs,
    git: a.git && b.git,
    worktrees: a.worktrees && b.worktrees,
    mcp: a.mcp && b.mcp,
    fileTransfer: a.fileTransfer && b.fileTransfer,
    collaboration: a.collaboration && b.collaboration,
    nodeAdmin: a.nodeAdmin && b.nodeAdmin,
    coldSessionResume: a.coldSessionResume && b.coldSessionResume,
    turnReattach: a.turnReattach && b.turnReattach,
    hostActionV1: a.hostActionV1 && b.hostActionV1,
    drafts: a.drafts && b.drafts,
  }
}

/**
 * Drop unknown capability keys from a wire payload so older/newer peers
 * remain forward-compatible. Known keys keep their values; missing booleans
 * default to false; harnessIds defaults to [].
 */
export function normalizeCapabilities(raw: unknown): EnvironmentCapabilities {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const harnessIds = Array.isArray(obj.harnessIds)
    ? obj.harnessIds.filter((id): id is HarnessId =>
        id === 'claude' || id === 'codex' || id === 'acp' || id === 'opencode',
      )
    : []

  const flag = (key: keyof EnvironmentCapabilities): boolean =>
    key === 'harnessIds' ? false : Boolean(obj[key])

  return {
    sessions: flag('sessions'),
    harnessIds,
    terminal: flag('terminal'),
    workspaceFs: flag('workspaceFs'),
    git: flag('git'),
    worktrees: flag('worktrees'),
    mcp: flag('mcp'),
    fileTransfer: flag('fileTransfer'),
    collaboration: flag('collaboration'),
    nodeAdmin: flag('nodeAdmin'),
    coldSessionResume: flag('coldSessionResume'),
    turnReattach: flag('turnReattach'),
    hostActionV1: flag('hostActionV1'),
    drafts: flag('drafts'),
  }
}
