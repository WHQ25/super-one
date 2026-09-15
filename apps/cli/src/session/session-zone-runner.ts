/**
 * Give every harness turn its session sync zone
 * (`docs/design/session-sync-zone.md` §5.4).
 *
 * One wrapper in front of the production runner rather than a branch per
 * harness: session start, cold resume and forked children all reach the
 * runner through `SessionRuntime.runTurn`, so this is the single place where
 * `SUPERONE_SESSION_DIR` and the `agent/` write grant are attached. The grant
 * is exactly that subdirectory — never the whole zone, which also holds the
 * desktop's captures — and it rides on `additionalDirectories`, which is what
 * both Claude (`additionalDirectories`) and Codex (`writableRoots`) already
 * honour.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TurnRunner } from '@superone/runtime/session'

export const SESSION_ZONE_AGENT_DIR = 'agent'

export function sessionZoneDir(syncRoot: string, sessionId: string): string {
  return join(syncRoot, sessionId)
}

export function withSessionZone(runner: TurnRunner, syncRoot: string): TurnRunner {
  const wrapped: TurnRunner = (input) => {
    const sessionDir = sessionZoneDir(syncRoot, input.session.sessionId)
    const agentDir = join(sessionDir, SESSION_ZONE_AGENT_DIR)
    // Harness sandboxes resolve their roots at start; a grant on a directory
    // that does not exist yet is silently dropped by some of them.
    mkdirSync(agentDir, { recursive: true })
    const additionalDirectories = input.additionalDirectories?.includes(agentDir)
      ? input.additionalDirectories
      : [...(input.additionalDirectories ?? []), agentDir]
    return runner({ ...input, sessionDir, additionalDirectories })
  }
  wrapped.disposeSession = runner.disposeSession
  wrapped.disposeAll = runner.disposeAll
  wrapped.listActiveRuntimes = runner.listActiveRuntimes
  return wrapped
}
