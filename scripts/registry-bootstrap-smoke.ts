/**
 * End-to-end smoke: desktop remote install + SSH bootstrap against a clean host.
 *
 * Exercises the real product path (design §15):
 *   probe → preflight → installNodeFromRegistry → bootstrapNodeOverSsh → /health
 *
 * Usage (from monorepo root, after clean-host is up):
 *   bun scripts/registry-bootstrap-smoke.ts
 *
 * Env:
 *   SUPERONE_SMOKE_SSH_PORT   default 2223
 *   SUPERONE_SMOKE_SSH_USER   default superone
 *   SUPERONE_SMOKE_SSH_HOST   default 127.0.0.1
 *   SUPERONE_SMOKE_IDENTITY   default apps/cli/docker/lab-keys/id_ed25519
 *   SUPERONE_SMOKE_CLI_VERSION default 0.49.5-alpha
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  installNodeFromRegistry,
  preflightBlocker,
  probeRemoteHost,
} from '../apps/desktop/src/main/environment/remote-install.ts'
import { bootstrapNodeOverSsh } from '../apps/desktop/src/main/environment/ssh-bootstrap.ts'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')

const host = process.env.SUPERONE_SMOKE_SSH_HOST || '127.0.0.1'
const port = Number(process.env.SUPERONE_SMOKE_SSH_PORT || '2223')
const user = process.env.SUPERONE_SMOKE_SSH_USER || 'superone'
const identity =
  process.env.SUPERONE_SMOKE_IDENTITY ||
  resolve(ROOT, 'apps/cli/docker/lab-keys/id_ed25519')
const version = process.env.SUPERONE_SMOKE_CLI_VERSION || '0.49.5-alpha'
const destination = `${user}@${host}`
const extraSshArgs = [
  '-p',
  String(port),
  '-i',
  identity,
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'UserKnownHostsFile=/dev/null',
  '-o',
  'BatchMode=yes',
  '-o',
  'LogLevel=ERROR',
]

function log(step: string, detail?: string): void {
  console.log(`[smoke] ${step}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  log('target', `${destination} (ssh :${port}, identity ${identity})`)
  log('cli version', version)

  log('probe')
  const probe = await probeRemoteHost({ destination, extraSshArgs })
  console.log(
    JSON.stringify(
      {
        os: probe.os,
        arch: probe.arch,
        home: probe.home,
        nodeMajor: probe.nodeMajor,
        hasNpm: probe.hasNpm,
        superonePath: probe.superonePath,
        hasSystemd: probe.hasSystemd,
      },
      null,
      2,
    ),
  )

  const blocker = preflightBlocker(probe, 'registry')
  if (blocker) {
    throw new Error(`preflight blocked: ${blocker}`)
  }
  if (probe.superonePath) {
    log('warn', `host already has superone at ${probe.superonePath}; reinstall will still pin version`)
  }

  log('install registry', `@super-one/cli@${version}`)
  const installed = await installNodeFromRegistry({
    destination,
    extraSshArgs,
    version,
    remoteHome: probe.home,
    onProgress: (phase, detail) => log(`install:${phase}`, detail),
  })
  console.log(JSON.stringify(installed, null, 2))

  log('bootstrap', 'start + pair-create + local forward')
  const boot = await bootstrapNodeOverSsh({
    destination,
    remoteExec: installed.remoteExec,
    extraSshArgs,
    label: 'clean-host-registry-smoke',
  })
  log('forward', boot.localBaseUrl)
  log('environmentId', boot.environmentId)
  if (boot.warnings.length) log('warnings', boot.warnings.join('; '))

  try {
    const healthUrl = `${boot.localBaseUrl}/health`
    log('health', healthUrl)
    const res = await fetch(healthUrl)
    const body = await res.text()
    if (!res.ok) throw new Error(`health HTTP ${res.status}: ${body}`)
    if (!body.includes('"ok"') && !body.includes('"status"')) {
      // Accept either shape; fail closed if empty.
      if (!body.trim()) throw new Error('health body empty')
    }
    console.log(body)
    log('OK', `registry install + bootstrap succeeded for @super-one/cli@${version}`)
  } finally {
    boot.forward.stop()
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED', err)
  process.exit(1)
})
