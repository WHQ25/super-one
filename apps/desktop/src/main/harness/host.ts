/**
 * Desktop host wiring for the harness kernel (`@superone/runtime/harness`).
 *
 * Supplies install root (prod: shared `~/.superone/harness`; dev: `.dev-data/harness`),
 * app version pin, binary discovery (managed install → bundled SDK → env),
 * tarball installer, and provider-store auth probe.
 */

import { app, net } from 'electron'
import { existsSync } from 'node:fs'
import {
  managedHarnessPrefix,
  readCurrentPointer,
  resolveExternalCommand,
  isCursorSdkAvailable,
  resolveCursorApiKeyPlain,
  setHarnessReleaseVersionProvider,
  type HarnessAuthProbe,
  type HarnessKernelDeps,
  type HarnessRuntimeResolver,
  type ResolvedAutoRuntime,
} from '@superone/runtime/harness'
import type { NodeHarnessId } from '@superone/shared/environment'
import type { ConsumerId } from '@superone/shared/platform-registry'
import { getBinding, listCredentials, getCredentialDecrypted } from '../providers/credential-store'
import { resolveSdkClaudeBinary } from '../agent/claude-binary'
import { resolveCursorApiKey } from '../cursor/cursor-auth'
import { getBaseProvider } from '../session/session-provider-repo'
import { allowBundledHarnessPlatformPackages } from './bundled-fallback'
import { resolveHarnessHomeRoot } from './home'
import {
  createDesktopTarballInstaller,
  resolveDesktopManagedBinary,
  type HttpFetch,
} from './tarball-installer'
import {
  findSystemCodexCli,
  resolveCodexNativeBinary,
  resolveCodexPlatformPackage,
  hasCodexPlatformPackage,
} from '../codex/app-server-connection'

// Pin managed artifacts to the app version (same role as CLI release version).
setHarnessReleaseVersionProvider(() => {
  try {
    return app.getVersion()
  } catch {
    return process.env.SUPERONE_CLI_VERSION?.trim() || '0.0.0-dev'
  }
})

function envBinary(name: string): string | null {
  const v = process.env[name]?.trim()
  return v && existsSync(v) ? v : null
}

function resolveBundledCodexNative(): string | null {
  if (!allowBundledHarnessPlatformPackages()) return null
  const pkg = resolveCodexPlatformPackage()
  if (!pkg || !hasCodexPlatformPackage(pkg)) return null
  return resolveCodexNativeBinary(pkg)?.binaryPath ?? null
}

function resolveManagedFromHome(id: 'claude' | 'codex'): string | null {
  const prefix = managedHarnessPrefix(resolveHarnessHomeRoot(), id)
  return resolveDesktopManagedBinary(id, prefix)
}

export const desktopHarnessResolver: HarnessRuntimeResolver = {
  resolveBinary(id, harnesses) {
    // Catalog command from a prior enable (highest priority after explicit env).
    if (id === 'claude') {
      const fromEnv = envBinary('SUPERONE_CLAUDE_BINARY')
      if (fromEnv) return fromEnv
      const status = harnesses.get('claude')
      if (
        status.enabled &&
        (status.state === 'ready' || status.state === 'needs_auth') &&
        status.command &&
        existsSync(status.command)
      ) {
        return status.command
      }
      return resolveManagedFromHome('claude') ?? resolveSdkClaudeBinary() ?? null
    }

    if (id === 'codex') {
      const fromEnv = envBinary('SUPERONE_CODEX_BINARY')
      if (fromEnv) return fromEnv
      const status = harnesses.get('codex')
      if (
        status.enabled &&
        (status.state === 'ready' || status.state === 'needs_auth') &&
        status.command &&
        existsSync(status.command)
      ) {
        return status.command
      }
      return (
        resolveManagedFromHome('codex') ??
        resolveBundledCodexNative() ??
        findSystemCodexCli()
      )
    }

    // External harnesses: catalog command or PATH/env.
    if (id === 'acp-grok') {
      return envBinary('SUPERONE_ACP_BINARY') ?? harnesses.get(id).command ?? null
    }
    if (id === 'opencode') {
      return envBinary('SUPERONE_OPENCODE_BINARY') ?? harnesses.get(id).command ?? null
    }
    if (id === 'cursor') {
      // In-process SDK — no host binary path.
      return null
    }
    return null
  },

  isRunnableWithoutCatalog(id) {
    if (id === 'claude') {
      return Boolean(
        envBinary('SUPERONE_CLAUDE_BINARY') ||
          resolveManagedFromHome('claude') ||
          resolveSdkClaudeBinary(),
      )
    }
    if (id === 'codex') {
      return Boolean(
        envBinary('SUPERONE_CODEX_BINARY') ||
          resolveManagedFromHome('codex') ||
          resolveBundledCodexNative() ||
          findSystemCodexCli(),
      )
    }
    if (id === 'acp-grok') return Boolean(envBinary('SUPERONE_ACP_BINARY'))
    if (id === 'opencode') return Boolean(envBinary('SUPERONE_OPENCODE_BINARY'))
    if (id === 'cursor') return isCursorSdkAvailable()
    return false
  },

  autoRuntime(id): ResolvedAutoRuntime | null {
    if (id === 'claude') {
      const managed = resolveManagedFromHome('claude')
      if (managed) {
        const ver = readCurrentPointer(managedHarnessPrefix(resolveHarnessHomeRoot(), 'claude'))
          ?.runtimeVersion
        return {
          command: managed,
          source: 'managed-tarball',
          ...(ver ? { runtimeVersion: ver } : {}),
        }
      }
      const sdk = resolveSdkClaudeBinary()
      if (sdk) return { command: sdk, source: 'agent-sdk-optional' }
      const fromEnv = envBinary('SUPERONE_CLAUDE_BINARY')
      if (fromEnv) return { command: fromEnv, source: 'env' }
      return null
    }
    if (id === 'codex') {
      const managed = resolveManagedFromHome('codex')
      if (managed) {
        const ver = readCurrentPointer(managedHarnessPrefix(resolveHarnessHomeRoot(), 'codex'))
          ?.runtimeVersion
        return {
          command: managed,
          source: 'managed-tarball',
          ...(ver ? { runtimeVersion: ver } : {}),
        }
      }
      const bundled = resolveBundledCodexNative()
      if (bundled) return { command: bundled, source: 'bundled-platform-package' }
      const fromEnv = envBinary('SUPERONE_CODEX_BINARY')
      if (fromEnv) return { command: fromEnv, source: 'env' }
      const fromPath = resolveExternalCommand(undefined, ['codex']) ?? findSystemCodexCli()
      if (fromPath) return { command: fromPath, source: 'path' }
      return null
    }
    return null
  },
}

/** Auth probe: desktop provider bindings for chat:claude / chat:codex; Cursor API key. */
export function desktopHarnessAuthProbe(): HarnessAuthProbe {
  return {
    hasCredentialFor(id: NodeHarnessId) {
      if (id === 'cursor') {
        if (resolveCursorApiKeyPlain()) return { ok: true, reason: 'CURSOR_API_KEY' }
        try {
          const config = getBaseProvider('cursor').config
          if (resolveCursorApiKey(config)) return { ok: true, reason: 'cursor provider apiKey' }
        } catch {
          /* no cursor-base provider yet */
        }
        return null
      }
      if (id !== 'claude' && id !== 'codex') return null
      const consumer: ConsumerId = id === 'codex' ? 'chat:codex' : 'chat:claude'
      const binding = getBinding(consumer)
      if (binding?.credentialId) {
        const cred = getCredentialDecrypted(binding.credentialId)
        if (cred) return { ok: true, reason: `provider binding ${consumer}` }
      }
      // Host-login path: any credential that could serve the harness family.
      if (listCredentials().length > 0) {
        return { ok: true, reason: 'desktop has provider credentials' }
      }
      // Claude/Codex may also auth via host CLI login (~/.claude / chatgpt) —
      // leave null so the kernel keeps needs_auth rather than fabricating ready.
      return null
    },
  }
}

/**
 * Chromium network stack (system HTTP(S) proxy, same path as Chrome).
 * Node's undici `fetch` ignores macOS system proxy and is much slower for
 * large harness tarballs when the user relies on a local proxy.
 */
function chromiumHttpFetch(): HttpFetch {
  return (input, init) =>
    net.fetch(input, init as Parameters<typeof net.fetch>[1]) as Promise<Response>
}

export function desktopHarnessDeps(): HarnessKernelDeps {
  return {
    home: { root: resolveHarnessHomeRoot() },
    releaseVersion: (() => {
      try {
        return app.getVersion()
      } catch {
        return process.env.SUPERONE_CLI_VERSION?.trim() || '0.0.0-dev'
      }
    })(),
    resolver: desktopHarnessResolver,
    installer: createDesktopTarballInstaller({
      httpFetch: chromiumHttpFetch(),
    }),
    auth: desktopHarnessAuthProbe(),
  }
}
