import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, basename, join, resolve } from 'node:path'
import { resolveExternalCommand } from './enable'
import type { HarnessCatalogReader } from './types'

/** One resolution policy for settings, readiness, chat, and account login. */
export function resolveGrokRuntime(catalog: HarnessCatalogReader, override?: { command?: string; args?: string[]; env?: Record<string, string> }): { command: string; args: string[]; source: 'path' | 'explicit' } | null {
  const status = catalog.get('acp-grok')
  if (!status.enabled) return null
  const config = catalog.getExternalLaunchConfig?.('acp-grok') ?? {}
  const saved = config.command ?? status.command
  // Older auto-discovery stored realpath(grok), without provenance. Only repair
  // missing version binaries in Grok's own install directory; never guess that
  // an arbitrary custom path (or an existing legacy pin) was automatic.
  const legacyMissingVersion = !config.commandSource && saved && !existsSync(saved)
    && dirname(resolve(saved)) === join(homedir(), '.grok', 'bin')
    && /^grok-\d+\.\d+/.test(basename(saved))
  const configured = config.commandSource === 'path' || legacyMissingVersion ? undefined : saved
  const explicit = override?.command?.trim()
    || override?.env?.SUPERONE_ACP_BINARY?.trim()
    || process.env.SUPERONE_ACP_BINARY?.trim()
    || configured
  // An invalid explicit override fails closed instead of silently using another CLI.
  const options = { preserveSymlinks: true, pathEnv: override?.env?.PATH }
  const bareCommand = explicit && !explicit.includes('/') && !explicit.includes('\\')
  let command = resolveExternalCommand(bareCommand ? undefined : explicit, [bareCommand ? explicit : 'grok'], options)
  if (!explicit && !command) {
    for (const dir of [join(homedir(), '.grok', 'bin'), join(homedir(), '.local', 'bin')]) {
      command = resolveExternalCommand(join(dir, 'grok'), [], { preserveSymlinks: true })
      if (command) break
    }
  }
  return command ? { command, args: override?.args ?? config.args ?? ['agent', 'stdio'], source: explicit ? 'explicit' : 'path' } : null
}
