import { randomUUID } from 'crypto'
import type { ForkContext, ForkSource } from '../types'

export async function forkAcpTranscript(
  _source: ForkSource,
  _targetCwd: string,
  _ctx: ForkContext,
): Promise<string> {
  return randomUUID()
}
