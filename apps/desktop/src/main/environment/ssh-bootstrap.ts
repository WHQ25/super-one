import { resolveNodeHome, DEFAULT_BIND_PORT } from '../../../../cli/src/config'
import { renderSystemdUserUnit } from '../../../../cli/src/systemd/unit'
import {
  findFreePort,
  sshCapture,
  startSshLocalForward,
  type SshForwardHandle,
} from './ssh-forward'

export interface SshBootstrapOptions {
  destination: string
  /** Remote absolute path to superone entry (or bun + script). */
  remoteExec: string
  remoteNodeHome?: string
  /** Remote home discovered during the initial host probe. */
  remoteHome?: string
  remotePort?: number
  extraSshArgs?: string[]
  sshPath?: string
  /** Remote bin directory containing a version-manager Node/npm installation. */
  nodeBinDir?: string | null
  label?: string
}

export interface SshBootstrapResult {
  localBaseUrl: string
  localPort: number
  forward: SshForwardHandle
  pairingToken: string
  environmentId: string
  expiresAt: number
  unitPreview: string
  warnings: string[]
}

/**
 * SSH bootstrap orchestration for Phase 1:
 * 1) probe remote host
 * 2) ensure node home exists / start node if needed (caller supplies remoteExec)
 * 3) create pairing token in-memory (stdout only)
 * 4) open loopback local forward
 *
 * Does not embed pairing tokens in saved shell history or argv beyond the
 * one-shot remote command string (parsed only in memory on the client).
 */
export async function bootstrapNodeOverSsh(opts: SshBootstrapOptions): Promise<SshBootstrapResult> {
  const warnings: string[] = []
  const remotePort = opts.remotePort ?? DEFAULT_BIND_PORT
  const sshOpts = {
    destination: opts.destination,
    extraArgs: opts.extraSshArgs,
    sshPath: opts.sshPath,
  }

  let remoteHome = opts.remoteHome?.trim() || ''
  let homeMatch: RegExpExecArray | null = null
  const needsProbe =
    !remoteHome && (!opts.remoteNodeHome || opts.remoteNodeHome.startsWith('~'))
  if (needsProbe) {
    const probe = await sshCapture({
      ...sshOpts,
      command: 'uname -s && printf "\\nHOME=%s\\n" "$HOME" && echo SUPERONE_SSH_OK',
      timeoutMs: 30_000,
    })
    if (probe.code !== 0 || !probe.stdout.includes('SUPERONE_SSH_OK')) {
      throw new Error(
        `ssh probe failed: ${probe.stderr || probe.stdout || `code ${probe.code}`}`,
      )
    }
    if (!probe.stdout.includes('Linux') && !probe.stdout.includes('Darwin')) {
      warnings.push(`unexpected remote OS: ${probe.stdout.trim()}`)
    }
    homeMatch = /HOME=([^\n]+)/.exec(probe.stdout)
    remoteHome = (homeMatch?.[1] || '').trim()
  }

  const requestedHome = opts.remoteNodeHome?.trim()
  const remoteAbsHome =
    requestedHome && !requestedHome.startsWith('~')
      ? requestedHome
      : requestedHome?.startsWith('~/') && remoteHome
        ? `${remoteHome}/${requestedHome.slice(2)}`
        : `${remoteHome || '/tmp'}/.superone/node`

  // Batch directory setup, node startup, health wait, and token creation into
  // one SSH session. This avoids triggering common SSH connection rate limits.
  const pairOut = await sshCapture({
    ...sshOpts,
    command: buildBootstrapCommand({
      remoteExec: opts.remoteExec,
      remoteNodeHome: remoteAbsHome,
      remotePort,
      nodeBinDir: opts.nodeBinDir,
    }),
    timeoutMs: 120_000,
  })
  if (pairOut.code !== 0) {
    throw new Error(`pair-create failed: ${pairOut.stderr || pairOut.stdout}`)
  }
  const pairJson = extractJsonObject(pairOut.stdout)
  if (!pairJson?.pairingToken || !pairJson?.environmentId) {
    throw new Error('pair-create did not return pairingToken/environmentId JSON')
  }

  const localPort = await findFreePort()
  const forward = await startSshLocalForward({
    destination: opts.destination,
    remotePort,
    localPort,
    extraArgs: opts.extraSshArgs,
    sshPath: opts.sshPath,
  })

  try {
    await waitForSshForwardHealth(forward.localBaseUrl)
  } catch (error) {
    forward.stop()
    throw error
  }

  const unitPreview = renderSystemdUserUnit({
    execStart: opts.remoteExec,
    nodeHome: remoteAbsHome,
    home: remoteHome || (homeMatch?.[1] || '').trim() || '/home/user',
    bindHost: '127.0.0.1',
    bindPort: remotePort,
  })

  return {
    localBaseUrl: forward.localBaseUrl,
    localPort: forward.localPort,
    forward,
    pairingToken: String(pairJson.pairingToken),
    environmentId: String(pairJson.environmentId),
    expiresAt: Number(pairJson.expiresAt ?? 0),
    unitPreview,
    warnings,
  }
}

export function buildBootstrapCommand(input: {
  remoteExec: string
  remoteNodeHome: string
  remotePort: number
  nodeBinDir?: string | null
}): string {
  const pathPrefix = input.nodeBinDir?.trim()
    ? `export PATH=${shellQuote(input.nodeBinDir.trim())}:$PATH && `
    : ''
  const execPath = shellQuote(input.remoteExec)
  const nodeHome = shellQuote(input.remoteNodeHome)
  const healthUrl = `http://127.0.0.1:${input.remotePort}/health`
  return (
    pathPrefix +
    [
      `mkdir -p ${nodeHome}/secrets ${nodeHome}/logs`,
      `chmod 700 ${nodeHome} ${nodeHome}/secrets || true`,
      `if ! curl -fsS ${healthUrl} >/dev/null 2>&1; then nohup ${execPath} start --foreground --home ${nodeHome} --host 127.0.0.1 --port ${input.remotePort} >${nodeHome}/logs/bootstrap.log 2>&1 & fi`,
      `healthy=0; i=0; while [ "$i" -lt 50 ]; do if curl -fsS ${healthUrl} >/dev/null 2>&1; then healthy=1; break; fi; i=$((i + 1)); sleep 0.2; done; if [ "$healthy" -ne 1 ]; then echo "remote node did not become healthy" >&2; exit 1; fi`,
      `${execPath} pair-create --home ${nodeHome}`,
    ].join(' && ')
  )
}

export async function waitForSshForwardHealth(
  baseUrl: string,
  options: {
    timeoutMs?: number
    retryDelayMs?: number
    requestTimeoutMs?: number
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const retryDelayMs = options.retryDelayMs ?? 100
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000
  const deadline = Date.now() + timeoutMs
  let lastError = 'not ready'

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, remainingMs)),
        ),
      })
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean
        } | null
        if (body?.ok === true) return
        lastError = 'invalid health response'
      } else {
        lastError = `health returned ${response.status}`
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    const delayMs = Math.min(retryDelayMs, deadline - Date.now())
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error(
    `ssh tunnel did not become ready within ${timeoutMs}ms: ${lastError}`,
  )
}

/** Pure helpers exported for unit tests (no live SSH). */
export function extractJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      /* try full buffer */
    }
  }
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildRemoteInstallCommands(input: {
  remoteExec: string
  nodeHome: string
  remotePort?: number
}): string[] {
  const home = input.nodeHome
  const port = input.remotePort ?? DEFAULT_BIND_PORT
  return [
    `mkdir -p ${shellQuote(home)}/secrets ${shellQuote(home)}/logs`,
    `chmod 700 ${shellQuote(home)} ${shellQuote(home)}/secrets`,
    `${input.remoteExec} install-systemd --home ${shellQuote(home)} --port ${port}`,
    `${input.remoteExec} pair-create --home ${shellQuote(home)}`,
  ]
}

// silence unused import when tree-shaken
void resolveNodeHome
