import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { buildOpenCodeServeEnv, defaultOpenCodeBinaryPath, type OpenCodeServerHandle } from './server'
import { startOpenCodeServer } from './server'
import { prepareNativeDatabase, nativeDatabasePath, interruptNativeDatabase, findOwnedNativeDatabase } from './native-database'
import { claimAttachedOpenCodeLocation } from './attached-service'

const execute = promisify(execFile)
const references = new Map<string, { ownerFile: string; refs: number; ready: Promise<OpenCodeServerHandle> }>()
type Options = { binaryPath?: string | null; cwd: string; env?: Record<string, string>; signal?: AbortSignal;
  home: string; sessionId: string; nativeSessionId?: string; admin?: boolean; hostMcp?: { url: string; headers: Record<string, string> } | null }

export async function startOpenCodeSessionServer(opts: Parameters<typeof startOpenCodeServer>[0] & { serviceHome?: string; sessionId: string;
  nativeSessionId?: string; admin?: boolean; hostMcp?: { url: string; headers: Record<string, string> } | null }) {
  if (opts.serviceHome && !opts.serverUrl?.trim()) {
    const owned = await startOwnedOpenCodeService({ ...opts, home: opts.serviceHome })
    if (owned) return { ...owned, protocol: 'v2' as const }
  }
  const server = await startOpenCodeServer(opts)
  if (server.protocol === 'v2' && opts.serverUrl?.trim() && !opts.admin) {
    try { return { ...claimAttachedOpenCodeLocation(server, opts.cwd, opts.sessionId), protocol: 'v2' as const } }
    catch (error) { await server.close(); throw error }
  }
  return { ...server, protocol: server.protocol ?? 'v1' as const }
}

function alive(pid: number) { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' } }

/** Official lifecycle on owned registration files, never the user's default service. */
export async function startOwnedOpenCodeService(opts: Options): Promise<OpenCodeServerHandle | undefined> {
  const binary = opts.binaryPath?.trim() || defaultOpenCodeBinaryPath()
  const env = buildOpenCodeServeEnv(opts.env)
  const { stdout } = await execute(binary, ['--version'], { cwd: opts.cwd, env, timeout: 5000, signal: opts.signal })
  const version = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/.exec(stdout)?.[1] ?? stdout.trim()
  if (!/^2\./.test(version)) return undefined
  if (typeof Promise.withResolvers !== 'function') throw new Error('OpenCode V2 service requires Node.js 22 or newer')
  if (opts.hostMcp) {
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, mcp: { ...config.mcp, servers: { ...config.mcp?.servers,
      superone: { type: 'remote', url: opts.hostMcp.url, headers: opts.hostMcp.headers, codemode: false } } } })
  }
  const key = createHash('sha256').update(JSON.stringify({ session: opts.sessionId, binary, version, host: opts.hostMcp,
    env: Object.entries(opts.env ?? {}).sort(([a], [b]) => a.localeCompare(b)), cwd: opts.cwd })).digest('hex')
  const adminDatabase = opts.admin && opts.nativeSessionId ? findOwnedNativeDatabase(opts.home, opts.nativeSessionId) : undefined
  const stateHome = join(opts.home, key), file = join(stateHome, 'opencode', 'service.json'), ownerFile = `${adminDatabase ?? nativeDatabasePath(opts.home, opts.sessionId)}.owner.json`
  const existing = opts.admin ? [...references].find(([, entry]) => entry.ownerFile === ownerFile) : undefined
  const referenceFile = existing?.[0] ?? file
  let entry = existing?.[1] ?? references.get(file)
  if (!entry) {
    entry = { ownerFile, refs: 0, ready: open() }
    references.set(file, entry)
    void entry.ready.catch(() => { if (references.get(file) === entry) references.delete(file) })
  }
  entry.refs++
  let closed = false
  const release = async () => {
    if (closed) return
    closed = true
    if (--entry!.refs > 0) return
    references.delete(referenceFile)
    await (await entry!.ready).close()
  }
  try {
    const handle = await entry.ready
    opts.signal?.throwIfAborted()
    return { ...handle, close: release }
  } catch (error) { await release().catch(() => {}); throw error }

  async function open(): Promise<OpenCodeServerHandle> {
    await mkdir(join(stateHome, 'opencode'), { recursive: true, mode: 0o700 })
    await mkdir(join(opts.home, 'databases'), { recursive: true, mode: 0o700 })
    await chmod(stateHome, 0o700)
    const nonce = randomUUID(), owner = { pid: process.pid, nonce, file }
    let previousFile: string | undefined
    try { await writeFile(ownerFile, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const reclaim = `${ownerFile}.reclaim`
      // One process may reclaim a stale owner; competing claimants cannot unlink
      // a fresh owner's proof. A crashed reclamation fails closed for inspection.
      await mkdir(reclaim)
      try {
        const prior = JSON.parse(await readFile(ownerFile, 'utf8')) as { pid?: number; file?: string }
        if (!Number.isInteger(prior.pid) || alive(prior.pid!)) throw new Error('Another SuperOne process owns this OpenCode session service')
        if (prior.file) {
          const path = relative(opts.home, prior.file)
          if (!/^[a-f0-9]{64}[\\/]opencode[\\/]service\.json$/.test(path)) throw new Error('OpenCode service registration is outside its owned directory')
          previousFile = prior.file
        }
        await rm(ownerFile)
        await writeFile(ownerFile, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
      } finally { await rm(reclaim, { recursive: true, force: true }) }
    }
    let service: typeof import('@opencode/client/service')['Service'] | undefined
    const configHome = join(stateHome, 'config'), configDir = join(configHome, 'opencode')
    const sourceConfig = opts.env?.OPENCODE_CONFIG_DIR ?? process.env.OPENCODE_CONFIG_DIR
      ?? join(opts.env?.XDG_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode')
    const serviceConfig = /^service(?:-[\w.-]+)?\.json$/
    const refreshConfig = async () => {
      await mkdir(configDir, { recursive: true, mode: 0o700 })
      const source = await readdir(sourceConfig, { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })
      for (const entry of await readdir(configDir)) if (!serviceConfig.test(entry)) await rm(join(configDir, entry), { recursive: true, force: true })
      for (const entry of source) if (!serviceConfig.test(entry.name)) {
        const target = join(configDir, entry.name), original = join(sourceConfig, entry.name)
        if (entry.isDirectory()) await symlink(original, target, process.platform === 'win32' ? 'junction' : 'dir')
        else await cp(original, target)
      }
    }
    const unlock = async () => {
      const current = await readFile(ownerFile, 'utf8').then(text => JSON.parse(text)).catch(() => null)
      if (current?.nonce === nonce) await rm(ownerFile, { force: true })
    }
    try {
      const { Service } = await import('@opencode/client/service'); service = Service
      if (previousFile && previousFile !== file) await Service.stop({ file: previousFile, pty: 'clear' })
      env.OPENCODE_DB = adminDatabase ?? prepareNativeDatabase(opts.home, opts.sessionId, opts.env ?? {}, opts.nativeSessionId)
      await refreshConfig()
      const discovered = await Service.discover({ file, version })
      const ensure = async () => {
        const healthy = await Service.discover({ file, version })
        if (healthy) return healthy
        interruptNativeDatabase(env.OPENCODE_DB)
        return Service.ensure({ file, version,
        command: [binary, 'serve', '--service', '--hostname=127.0.0.1', '--port=0'],
        env: { ...env, XDG_STATE_HOME: stateHome, XDG_CONFIG_HOME: configHome, OPENCODE_CONFIG_DIR: configDir },
        })
      }
      const endpoint = discovered ?? await ensure()
      if (!endpoint.auth || endpoint.auth.username !== 'opencode') throw new Error('Owned OpenCode service did not enable private authentication')
      await chmod(file, 0o600)
      let closing: Promise<void> | undefined
      let reconnecting: Promise<{ url: string; password: string; replaced: boolean }> | undefined
      const identity = () => readFile(file, 'utf8').then(text => { const info = JSON.parse(text); return `${info.id ?? ''}:${info.pid}` }).catch(() => '')
      let currentIdentity = await identity()
      return { url: endpoint.url, password: endpoint.auth.password, protocol: 'v2', exited: null, refreshConfig, reused: Boolean(discovered), hostMcpConfigured: Boolean(opts.hostMcp),
        reconnect: () => {
          if (closing) return Promise.reject(new Error('OpenCode service is closing'))
          return reconnecting ??= (async () => {
            const owner = await readFile(ownerFile, 'utf8').then(text => JSON.parse(text))
            if (owner.nonce !== nonce) throw new Error('OpenCode service ownership changed')
            const endpoint = await ensure()
            if (closing) throw new Error('OpenCode service is closing')
            if (!endpoint.auth || endpoint.auth.username !== 'opencode') throw new Error('Owned OpenCode service authentication is unavailable')
            const nextIdentity = await identity(), replaced = nextIdentity !== currentIdentity
            currentIdentity = nextIdentity
            return { url: endpoint.url, password: endpoint.auth.password, replaced }
          })().finally(() => { reconnecting = undefined })
        },
        close: () => closing ??= Promise.resolve(reconnecting).catch(() => {}).then(() => Service.stop({ file, pty: 'clear' })).finally(unlock) }
    } catch (error) { await service?.stop({ file, pty: 'clear' }).catch(() => {}); await unlock(); throw error }
  }
}
