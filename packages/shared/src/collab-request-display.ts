import type { SessionAgentLaunchProposal, SessionAgentProfile, SessionAgentWorktreeConfig } from './agent-types'

/**
 * Pure label derivations for the "request agents collaboration" confirm UI. Desktop
 * and Remote Control render the same proposal, so what a launch is *called* has one
 * source — a phone that invented its own tab label would drift from the desktop the
 * moment a naming rule changed there.
 */

export function isLinkLaunch(launch: SessionAgentLaunchProposal): boolean {
  return launch.mode === 'link'
}

/**
 * Handoff shares spawn's card (agent profile, editable model/permission), so the
 * header prefix is the only thing telling the user this launch is one-way and
 * lands as a top-level sibling rather than a child they can keep talking to.
 */
export function isHandoffLaunch(launch: SessionAgentLaunchProposal): boolean {
  return launch.mode === 'handoff'
}

export function pathBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/**
 * Tab labels always show harness (Claude / Grok / …), including link launches
 * (peer session harness). Duplicate harnesses get a 1-based suffix.
 */
export function buildLaunchTabLabels(launches: SessionAgentLaunchProposal[], profiles: SessionAgentProfile[]): string[] {
  const harnessOf = (launch: SessionAgentLaunchProposal): string => {
    if (isLinkLaunch(launch)) {
      return (launch.peerHarnessName?.trim() || launch.peerHarnessId || 'Agent')
    }
    return profiles.find((profile) => profile.id === launch.agentId)?.name ?? launch.agentId
  }
  const totals = new Map<string, number>()
  for (const launch of launches) totals.set(harnessOf(launch), (totals.get(harnessOf(launch)) ?? 0) + 1)
  const seen = new Map<string, number>()
  return launches.map((launch) => {
    const label = harnessOf(launch)
    if ((totals.get(label) ?? 0) < 2) return label
    const index = (seen.get(label) ?? 0) + 1
    seen.set(label, index)
    return `${label} ${index}`
  })
}

/** Agent-chosen display name + role for the content header (`Name - Role`). Spawn only. */
export function launchNameRoleLine(launch: SessionAgentLaunchProposal): string {
  const name = (launch.name ?? launch.config.name)?.trim() || 'Agent'
  const role = (launch.role ?? launch.config.role)?.trim()
  return role ? `${name} - ${role}` : name
}

export function peerSessionTitle(launch: SessionAgentLaunchProposal): string {
  return (launch.peerTitle || launch.name || launch.sessionId || 'session').trim()
}

/** Compact peer session id for a meta chip; the full id goes in the tooltip. */
export function shortSessionId(sessionId: string | undefined): string | null {
  if (!sessionId) return null
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId
}

/**
 * Where a launch will run, in the status bar's *pending* vocabulary: a launch always
 * describes a worktree that does not exist yet, and no worktree means the session runs
 * in its cwd.
 */
export type LaunchWorkDir =
  | { kind: 'local' }
  | { kind: 'createFrom'; base: string }
  | { kind: 'attachTo'; base: string }
  | { kind: 'createBranch'; name: string }

export function launchWorkDir(worktree: SessionAgentWorktreeConfig | null | undefined): LaunchWorkDir {
  if (!worktree?.enabled) return { kind: 'local' }
  if (worktree.mode === 'detach') return { kind: 'createFrom', base: worktree.baseBranch }
  if (worktree.mode === 'attach') return { kind: 'attachTo', base: worktree.baseBranch }
  return { kind: 'createBranch', name: worktree.branchName ?? '' }
}
