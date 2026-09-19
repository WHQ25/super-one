/**
 * Host events for the `*_run` loops: the chat shows a run as the actions it
 * took, so each step is reported while the tool call is still open.
 *
 * The resolver is installed by the MCP server, the same way the browser WebMCP
 * and device-control prompts get theirs, so this module does not reach for the
 * session host itself.
 */

import type { AgentEvent, JevRunAction, JevRunOutcome, JevRunPlatform } from '@superone/shared/agent-types'

type Resolver = (sessionId: string) => ((event: AgentEvent) => void) | null

let resolve: Resolver = () => null

export function setJevRunHostEventResolver(resolver: Resolver | null): void {
  resolve = resolver ?? (() => null)
}

export interface RunReporter {
  action(action: JevRunAction): void
  outcome(outcome: JevRunOutcome): void
}

/** A reporter for one run; a session without a host emitter gets a silent one. */
export function runReporter(sessionId: string, runId: string, platform: JevRunPlatform): RunReporter {
  const emit = resolve(sessionId)
  if (!emit) return { action: () => {}, outcome: () => {} }
  return {
    action: (action) => emit({ type: 'jev_run_update', runId, platform, action }),
    outcome: (outcome) => emit({ type: 'jev_run_update', runId, platform, outcome }),
  }
}
