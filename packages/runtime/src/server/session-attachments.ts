import { isAbsolute, join, sep } from 'node:path'
import { statSync } from 'node:fs'
import type { RpcContext } from './rpc-context'

export function attachmentOriginal(ctx: RpcContext, sessionId: string, path: unknown): string | null {
  if (ctx.sameHost) {
    try {
      return typeof path === 'string' && isAbsolute(path) && statSync(path).isFile() ? path : null
    } catch {
      return null
    }
  }
  const zone = ctx.artifacts
  if (!zone) return null
  const prefix = join(zone.syncRoot, sessionId) + sep
  if (typeof path !== 'string' || !path.startsWith(prefix)) return null
  try {
    const resolved = zone.resolve(sessionId, path.slice(prefix.length).split(sep).join('/'))
    return statSync(resolved).isFile() ? resolved : null
  } catch {
    return null
  }
}
