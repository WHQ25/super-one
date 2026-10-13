import type { HarnessCatalogReader } from '@superone/runtime/harness'
import type { OpenCodeResources } from '@superone/shared/agent-types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startOpenCodeSessionServer } from './owned-service'
import type { startOpenCodeServer, OpenCodeServerHandle } from './server'
import { OpenCodeV2Client } from './opencode-v2-client'

/** Resolve at each turn/probe so enabling or configuring a node takes effect. */
export function resolveOpenCodeLaunch(opts: { binaryPath?: string | null; harnesses?: HarnessCatalogReader | null }) {
  const status = opts.harnesses?.get('opencode')
  const ready = status?.enabled && (status.state === 'ready' || status.state === 'needs_auth')
  const config = ready ? opts.harnesses?.getExternalLaunchConfig?.('opencode') : undefined
  return {
    binaryPath:
      opts.binaryPath?.trim() || process.env.SUPERONE_OPENCODE_BINARY?.trim() || (ready ? status.command : undefined),
    serverUrl: config?.serverUrl,
  }
}

/** Both host entrypoints use this probe; V1 retains its ordinary spawn path. */
export async function startOpenCodeCatalogServer(opts: Parameters<typeof startOpenCodeServer>[0]): Promise<OpenCodeServerHandle> {
  const home = opts.serverUrl ? undefined : await mkdtemp(join(tmpdir(), 'superone-opencode-catalog-'))
  try {
    const server = await startOpenCodeSessionServer({ ...opts, serviceHome: home, sessionId: 'catalog-probe', admin: true })
    let closing: Promise<void> | undefined
    return { ...server, close: () => closing ??= server.close().finally(async () => {
      if (home) await rm(home, { recursive: true, force: true })
    }) }
  } catch (error) {
    if (home) await rm(home, { recursive: true, force: true })
    throw error
  }
}

/** Native V2 catalog probe; no session, model execution or MCP credentials. */
export async function discoverOpenCodeV2Resources(
  cwd: string,
  opts: Parameters<typeof resolveOpenCodeLaunch>[0] & { env?: Record<string, string> },
): Promise<OpenCodeResources | null> {
  const launch = resolveOpenCodeLaunch(opts)
  if (!launch.binaryPath && !launch.serverUrl) return null
  const abort = new AbortController()
  // Native startup can resume suspended sessions. Catalog reads use a temporary
  // credentials-only database, never the user's live executor database.
  let server: OpenCodeServerHandle | undefined
  try {
    server = await startOpenCodeCatalogServer({
      ...launch,
      env: opts.env,
      cwd,
      signal: abort.signal,
    })
    if (server.protocol !== 'v2') return null
    return await new OpenCodeV2Client({
      baseUrl: server.url,
      password: server.password,
      directory: cwd,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    }).resources()
  } finally {
    abort.abort()
    await server?.close()
  }
}
