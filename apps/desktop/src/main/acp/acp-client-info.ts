import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Version string advertised as ACP clientInfo.version.
 * Prefer Electron app.getVersion() in production; fall back to package.json
 * for unit tests / non-Electron hosts.
 */
export function resolveAcpClientVersion(): string {
  try {
    const electron = require('electron') as { app?: { getVersion?: () => string } }
    const v = electron.app?.getVersion?.()
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch {
    // electron unavailable (vitest without mock, etc.)
  }
  try {
    // apps/desktop/package.json relative to this file (src/main/acp/)
    const pkg = require('../../../package.json') as { version?: string }
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
  } catch {
    // ignore
  }
  return '0.0.0'
}
