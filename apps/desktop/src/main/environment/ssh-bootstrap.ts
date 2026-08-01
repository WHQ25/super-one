import { resolveNodeHome, DEFAULT_BIND_PORT } from '../../../../cli/src/config'
import { renderSystemdUserUnit } from '../../../../cli/src/systemd/unit'
import { findFreePort, sshCapture, startSshLocalForward, type SshForwardHandle } from './ssh-forward'

export interface SshBootstrapOptions {
  destination: string
  /** Remote absolute path to superone entry (or bun + script). */
  remoteExec: string
  remoteNodeHome?: string
  remotePort?: number
  extraSshArgs?: string[]
  sshPath?: string
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

  const probe = await sshCapture({
    ...sshOpts,
    command: 'uname -s && printf "\\nHOME=%s\\n" "$HOME" && echo SUPERONE_SSH_OK',
    timeoutMs: 30_000,
  })
  if (probe.code !== 0 || !probe.stdout.includes('SUPERONE_SSH_OK')) {
    throw new Error(`ssh probe failed: ${probe.stderr || probe.stdout || `code ${probe.code}`}`)
  }
  if (!probe.stdout.includes('Linux') && !probe.stdout.includes('Darwin')) {
    warnings.push(`unexpected remote OS: ${probe.stdout.trim()}`)
  }
  // Resolve absolute remote home — never quote tilde as a literal path.
  const homeMatch = /HOME=([^\n]+)/.exec(probe.stdout)
  const remoteAbsHome =
    opts.remoteNodeHome && !opts.remoteNodeHome.startsWith('~')
      ? opts.remoteNodeHome
      : `${(homeMatch?.[1] || '').trim() || '/tmp'}/.superone/node`

  // Ensure remote node home exists (best-effort).
  await sshCapture({
    ...sshOpts,
    command: `mkdir -p ${shellQuote(remoteAbsHome)}/secrets ${shellQuote(remoteAbsHome)}/logs && chmod 700 ${shellQuote(remoteAbsHome)} ${shellQuote(remoteAbsHome)}/secrets || true`,
  })

  // Start node in background if not healthy (best-effort; may already be running under systemd).
  const healthCheck = await sshCapture({
    ...sshOpts,
    command: `curl -fsS http://127.0.0.1:${remotePort}/health 2>/dev/null || echo NO_HEALTH`,
  })
  if (healthCheck.stdout.includes('NO_HEALTH') || !healthCheck.stdout.includes('"ok"')) {
    await sshCapture({
      ...sshOpts,
      command: `nohup ${opts.remoteExec} start --foreground --home ${shellQuote(remoteAbsHome)} --host 127.0.0.1 --port ${remotePort} >${shellQuote(remoteAbsHome)}/logs/bootstrap.log 2>&1 & sleep 0.5; echo STARTED`,
      timeoutMs: 15_000,
    })
  }

  // Create pairing token — parse JSON from stdout only; do not log the token.
  const pairOut = await sshCapture({
    ...sshOpts,
    command: `${opts.remoteExec} pair-create --home ${shellQuote(remoteAbsHome)}`,
    timeoutMs: 15_000,
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

  const unitPreview = renderSystemdUserUnit({
    execStart: opts.remoteExec,
    nodeHome: remoteAbsHome,
    home: (homeMatch?.[1] || '').trim() || '/home/user',
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
