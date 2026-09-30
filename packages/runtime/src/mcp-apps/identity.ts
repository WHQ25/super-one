import { createHash } from 'node:crypto'

/** Storage identity never contains env/header values or rotating access tokens. */
export function mcpServerConfigFingerprint(config: unknown): string {
  const value = config && typeof config === 'object' ? config as Record<string, unknown> : {}
  let url: string | undefined
  if (typeof value.url === 'string') {
    try { const parsed = new URL(value.url); url = `${parsed.origin}${parsed.pathname}` } catch { /* invalid config remains isolated */ }
  }
  return createHash('sha256').update(JSON.stringify({ command: value.command, args: value.args, url })).digest('hex')
}
