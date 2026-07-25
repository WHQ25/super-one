import type { ForkContext, ForkSource } from '../types'

/**
 * PR1 stub — cold fork is deferred (design open question / PR13).
 * Throws a clear error so session-manager surfaces unsupported fork.
 */
export async function forkCursorTranscript(
  _source: ForkSource,
  _targetCwd: string,
  _ctx: ForkContext,
): Promise<string> {
  throw new Error(
    'Cursor session fork is not supported yet. Design: docs/design/cursor-sdk-harness.md PR13.',
  )
}
