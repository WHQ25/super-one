/**
 * Local remote-node lab (monorepo dev): pair the desktop to a host-process
 * `superone` node on loopback — same protocol as a real remote environment.
 *
 * Defaults match `scripts/remote-cli-local.sh` / `bun run dev:cli:lab`.
 * Only available in non-packaged (dev) builds.
 */

import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EnvironmentHost } from './environment-host'

export interface LocalLabDefaults {
  host: string
  port: number
  baseUrl: string
  label: string
  nodeHome: string
}

export interface LocalLabStatus {
  available: boolean
  baseUrl: string
  label: string
  nodeHome: string
  reachable: boolean
  environmentId?: string
  nodePublicKeyFingerprint?: string
  error?: string
  /** Hint when the lab process is down. */
  startHint: string
}

export interface PairLocalLabResult {
  connectionId: string
  alreadyPaired: boolean
  persisted: boolean
  baseUrl: string
  label: string
}

const START_HINT = 'bun run dev:cli:lab'

export function localLabDefaults(): LocalLabDefaults {
  const host = process.env.SUPERONE_NODE_HOST?.trim() || '127.0.0.1'
  const portRaw = process.env.SUPERONE_NODE_PORT?.trim() || '7789'
  const port = Number(portRaw) || 7789
  const nodeHome =
    process.env.SUPERONE_NODE_HOME?.trim() || join(homedir(), '.superone', 'node-dev-lab')
  const label = process.env.SUPERONE_NODE_LABEL?.trim() || 'local-dev-lab'
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    label,
    nodeHome,
  }
}

/** True when a URL/target points at loopback (local lab, not LAN mesh). */
export function isLoopbackTarget(target: string | undefined | null): boolean {
  if (!target?.trim()) return false
  const raw = target.trim()
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`http://${raw}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(raw)
  }
}

export function resolveMonorepoRoot(appPath = app.getAppPath()): string | null {
  const candidates = [
    appPath,
    join(appPath, '..'),
    join(appPath, '../..'),
    join(appPath, '../../..'),
    process.cwd(),
    join(process.cwd(), '..'),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'apps/cli/src/cli.ts')) && existsSync(join(dir, 'package.json'))) {
      return dir
    }
  }
  return null
}

export async function probeLocalLabHealth(
  baseUrl: string,
  opts?: { timeoutMs?: number },
): Promise<{
  ok: boolean
  environmentId?: string
  nodePublicKeyFingerprint?: string
  error?: string
}> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 2_000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) {
      return { ok: false, error: `health HTTP ${res.status}` }
    }
    const body = (await res.json()) as {
      ok?: boolean
      environmentId?: string
      nodePublicKeyFingerprint?: string
    }
    if (!body.ok || !body.environmentId) {
      return { ok: false, error: 'invalid health body' }
    }
    return {
      ok: true,
      environmentId: body.environmentId,
      nodePublicKeyFingerprint: body.nodePublicKeyFingerprint,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Mint a one-time pairing token against the lab node home by running
 * `pair-create` from monorepo CLI sources (same DB the running lab uses).
 */
export async function mintLocalLabPairingToken(nodeHome: string): Promise<{
  pairingToken: string
  environmentId: string
  expiresAt: number
}> {
  if (app.isPackaged) {
    throw new Error('Local lab pairing is only available in development builds')
  }
  const root = resolveMonorepoRoot()
  if (!root) {
    throw new Error(
      'Could not locate monorepo apps/cli (local lab requires a SuperOne monorepo checkout)',
    )
  }
  const cliEntry = join(root, 'apps/cli/src/cli.ts')
  const cliCwd = join(root, 'apps/cli')
  const json = await spawnPairCreate(cliEntry, cliCwd, nodeHome)
  let parsed: { pairingToken?: string; environmentId?: string; expiresAt?: number }
  try {
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    throw new Error(`pair-create returned non-JSON: ${json.slice(0, 200)}`)
  }
  if (!parsed.pairingToken || !parsed.environmentId) {
    throw new Error('pair-create response missing pairingToken or environmentId')
  }
  return {
    pairingToken: parsed.pairingToken,
    environmentId: parsed.environmentId,
    expiresAt: parsed.expiresAt ?? 0,
  }
}

function spawnPairCreate(cliEntry: string, cwd: string, nodeHome: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('bunx', ['tsx', cliEntry, 'pair-create'], {
      cwd,
      env: {
        ...process.env,
        SUPERONE_NODE_HOME: nodeHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      reject(new Error(`failed to run pair-create: ${err.message}`))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `pair-create exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ''}`,
          ),
        )
        return
      }
      const line = stdout
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('{'))
      if (!line) {
        reject(new Error(`pair-create produced no JSON on stdout: ${stdout.slice(0, 200)}`))
        return
      }
      resolve(line)
    })
  })
}

export async function getLocalLabStatus(): Promise<LocalLabStatus> {
  const defaults = localLabDefaults()
  const base: LocalLabStatus = {
    available: !app.isPackaged,
    baseUrl: defaults.baseUrl,
    label: defaults.label,
    nodeHome: defaults.nodeHome,
    reachable: false,
    startHint: START_HINT,
  }
  if (app.isPackaged) {
    return { ...base, error: 'Local lab is only available in development builds' }
  }
  const health = await probeLocalLabHealth(defaults.baseUrl)
  if (!health.ok) {
    return {
      ...base,
      reachable: false,
      error: health.error ?? 'not reachable',
    }
  }
  return {
    ...base,
    reachable: true,
    environmentId: health.environmentId,
    nodePublicKeyFingerprint: health.nodePublicKeyFingerprint,
  }
}

/**
 * True when reconnect failed because the node rejected the stored refresh
 * credential (revoked session, reuse detection, expired/invalid token).
 * Local lab should forget + re-pair in these cases rather than surface a dead
 * "already paired" connection.
 */
export function isLocalLabAuthReconnectError(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : ''
  if (code === 'unauthorized' || code === 'revoked') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /client session revoked|refresh token reuse|invalid refresh token|refresh token expired|pairing token|unauthorized/i.test(
    msg,
  )
}

/**
 * One-click: health-check lab → reuse existing pairing or mint token + pairRemote.
 * If a prior pairing's session was revoked on the node (common after lab DB
 * churn or refresh-token races), forget client state and re-pair automatically.
 */
export async function pairLocalLab(host: EnvironmentHost): Promise<PairLocalLabResult> {
  if (app.isPackaged) {
    throw new Error('Local lab pairing is only available in development builds')
  }
  const defaults = localLabDefaults()
  const health = await probeLocalLabHealth(defaults.baseUrl)
  if (!health.ok) {
    throw new Error(
      `Local lab not reachable at ${defaults.baseUrl} (${health.error ?? 'offline'}). Start it with: ${START_HINT}`,
    )
  }

  const normalized = defaults.baseUrl.replace(/\/$/, '')
  const existing = host.connections
    .listKnown()
    .find((k) => (k.baseUrl ?? '').replace(/\/$/, '') === normalized)

  if (existing) {
    try {
      await host.connect(existing.connectionId)
      return {
        connectionId: existing.connectionId,
        alreadyPaired: true,
        persisted: true,
        baseUrl: defaults.baseUrl,
        label: existing.label || defaults.label,
      }
    } catch (err) {
      if (!isLocalLabAuthReconnectError(err)) throw err
      // Stale credential on desktop while node session is gone — re-pair.
      host.forget(existing.connectionId)
    }
  }

  const { pairingToken } = await mintLocalLabPairingToken(defaults.nodeHome)
  const paired = await host.pairRemote({
    baseUrl: defaults.baseUrl,
    pairingToken,
    label: defaults.label,
  })
  return {
    connectionId: paired.connectionId,
    alreadyPaired: false,
    persisted: paired.persisted,
    baseUrl: defaults.baseUrl,
    label: defaults.label,
  }
}
