import type { ForkContext, ForkSource } from '../types'

/**
 * DeepSeek Harness fork — P0 stub. The real implementation uses
 * `ctx.sessions.fork(source, boundary?, childSessionId?)` on the embedded dsh
 * tree (docs/draft/deepseek-harness-integration.md, D8) once P4 lands.
 */
export async function forkDeepseekTranscript(
  _source: ForkSource,
  _targetCwd: string,
  _ctx: ForkContext,
): Promise<string> {
  throw new Error('DeepSeek harness does not support fork yet')
}
