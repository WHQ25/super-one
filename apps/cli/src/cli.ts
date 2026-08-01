/**
 * superone CLI
 *
 * Not directly executable: run it through `tsx` in development, or through the
 * `bin/superone` launcher in a built distribution (see scripts/build-dist.ts).
 * `bun run` crashes on better-sqlite3's Node-API addon.
 *
 * Commands:
 *   start [--foreground] [--home DIR] [--host HOST] [--port PORT]
 *   pair-create [--home DIR]
 *   status [--home DIR]
 *   identity [--home DIR]
 *   identity regenerate [--home DIR]
 *   install-systemd [--home DIR] [--exec PATH]
 *   uninstall-systemd
 *   systemd-status
 *   harness <list|show|enable|disable|configure|doctor|repair> …
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT, resolveNodeHome } from './config'
import { loadOrCreateIdentity, regenerateIdentity } from './identity'
import { createLocalPairingToken, readRuntimeStatus, startNodeRuntime } from './runtime'
import {
  installSystemdUserService,
  systemdUserStatus,
  uninstallSystemdUserService,
} from './systemd/install'
import { harnessUsage, runHarnessCli } from './session/harness-cli'

function usage(): never {
  console.log(`Usage: superone <command> [options]

Commands:
  start [--foreground] [--home DIR] [--host HOST] [--port PORT] [--label NAME]
  pair-create [--home DIR]
  status [--home DIR]
  identity [--home DIR]
  identity regenerate [--home DIR]
  install-systemd [--home DIR] [--exec PATH] [--host HOST] [--port PORT]
  uninstall-systemd
  systemd-status
  harness list|show|enable|disable|configure|doctor|repair …

Harness data directory is $HOME/.superone/node (SUPERONE_NODE_HOME for tests only).
`)
  process.exit(1)
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i >= 0 && i + 1 < args.length) return args[i + 1]
  return undefined
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd) usage()

  const rest = argv.slice(1)

  if (cmd === 'start') {
    const nodeHome = resolveNodeHome(argValue(rest, '--home'))
    const host = argValue(rest, '--host') || DEFAULT_BIND_HOST
    const port = Number(argValue(rest, '--port') || DEFAULT_BIND_PORT)
    const label = argValue(rest, '--label')
    const foreground = hasFlag(rest, '--foreground') || !process.stdout.isTTY

    const runtime = await startNodeRuntime({
      nodeHome,
      bindHost: host,
      bindPort: port,
      label,
      // Session RPC enabled by default (injectable turn runner). Collaboration
      // still requires simulatedHarness for tests.
    })

    console.log(
      JSON.stringify(
        {
          ok: true,
          environmentId: runtime.identity.environmentId,
          nodePublicKeyFingerprint: runtime.identity.publicKeyFingerprint,
          url: runtime.server.url,
          nodeHome,
        },
        null,
        2,
      ),
    )

    const shutdown = async () => {
      try {
        await runtime.stop()
      } finally {
        process.exit(0)
      }
    }
    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())

    if (!foreground) {
      // When not --foreground, still stay alive (systemd uses --foreground).
    }
    // Keep process alive
    await new Promise(() => {})
    return
  }

  if (cmd === 'pair-create') {
    const nodeHome = resolveNodeHome(argValue(rest, '--home'))
    const pair = createLocalPairingToken(nodeHome)
    // Print token once on stdout for SSH bootstrap to parse in-memory.
    // Callers must not log this line.
    console.log(
      JSON.stringify({
        environmentId: pair.environmentId,
        expiresAt: pair.expiresAt,
        pairingToken: pair.token,
      }),
    )
    return
  }

  if (cmd === 'status') {
    const nodeHome = resolveNodeHome(argValue(rest, '--home'))
    const identity = loadOrCreateIdentity(nodeHome)
    const runtime = readRuntimeStatus(nodeHome)
    console.log(
      JSON.stringify(
        {
          environmentId: identity.environmentId,
          nodePublicKeyFingerprint: identity.publicKeyFingerprint,
          bindingHash: identity.bindingHash,
          nodeHome,
          runtime,
        },
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'identity') {
    const nodeHome = resolveNodeHome(argValue(rest, '--home'))
    if (rest[0] === 'regenerate') {
      const identity = regenerateIdentity(nodeHome)
      console.log(
        JSON.stringify(
          {
            regenerated: true,
            environmentId: identity.environmentId,
            nodePublicKeyFingerprint: identity.publicKeyFingerprint,
            bindingHash: identity.bindingHash,
          },
          null,
          2,
        ),
      )
      return
    }
    const identity = loadOrCreateIdentity(nodeHome)
    console.log(
      JSON.stringify(
        {
          environmentId: identity.environmentId,
          nodePublicKeyFingerprint: identity.publicKeyFingerprint,
          bindingHash: identity.bindingHash,
          label: identity.label,
          nodeHome,
        },
        null,
        2,
      ),
    )
    return
  }

  if (cmd === 'install-systemd') {
    const nodeHome = resolveNodeHome(argValue(rest, '--home'))
    const execStart =
      argValue(rest, '--exec') || resolve(process.argv[1] || 'superone')
    const host = argValue(rest, '--host') || DEFAULT_BIND_HOST
    const port = Number(argValue(rest, '--port') || DEFAULT_BIND_PORT)
    const result = installSystemdUserService({
      execStart: `${process.execPath} ${execStart}`,
      nodeHome,
      home: process.env.HOME || homedir(),
      bindHost: host,
      bindPort: port,
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.enabled || result.lingerEnabled === false) {
      process.exitCode = 2
    }
    return
  }

  if (cmd === 'uninstall-systemd') {
    const result = uninstallSystemdUserService()
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (cmd === 'systemd-status') {
    const result = systemdUserStatus()
    console.log(result.raw)
    process.exitCode = result.ok ? 0 : 1
    return
  }

  if (cmd === 'harness') {
    if (rest[0] === '--help' || rest[0] === '-h') {
      console.log(harnessUsage())
      return
    }
    const result = await runHarnessCli(rest)
    if (result.json != null) {
      console.log(JSON.stringify(result.json, null, 2))
    } else if (result.text) {
      console.log(result.text)
    }
    process.exitCode = result.exitCode
    return
  }

  usage()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
