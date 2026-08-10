/**
 * CLI host wiring for the harness kernel (`@superone/runtime/harness`).
 *
 * The kernel is host-agnostic; this module supplies the CLI's answers to its
 * injection seams: where the node home is, how the release version resolves,
 * how binaries are discovered, how bytes are fetched (npm), and how provider
 * credentials are checked.
 */

import { existsSync } from 'node:fs'
import {
  createOfficialNpmInstaller,
  resolveExternalCommand,
  setHarnessReleaseVersionProvider,
  type HarnessAuthProbe,
  type HarnessKernelDeps,
  type HarnessRuntimeResolver,
  type ResolvedAutoRuntime,
} from '@superone/runtime/harness'
import { resolveSdkClaudeBinary } from '@superone/claude'
import { resolveCliReleaseVersion } from '../cli-release-version'
import { resolveNodeHome } from '../config'
import { isClaudeRuntimeRunnable, resolveClaudeBinaryPath } from './claude-turn-runner'
import { isCodexBinaryOverrideRunnable, resolveCodexBinaryPath } from './codex-turn-runner'
import { consumerForHarness } from '../provider/resolve-service'
import type { ProviderStore } from '../provider/provider-store'

// Managed artifact paths are pinned to the CLI release version.
setHarnessReleaseVersionProvider(resolveCliReleaseVersion)

function envBinaryExists(envName: string): boolean {
  const v = process.env[envName]?.trim()
  return Boolean(v && existsSync(v))
}

export const cliHarnessResolver: HarnessRuntimeResolver = {
  resolveBinary(id, harnesses) {
    if (id === 'claude') return resolveClaudeBinaryPath({ harnesses })
    if (id === 'codex') return resolveCodexBinaryPath({ harnesses })
    // External harnesses (acp-grok / opencode) run whatever the catalog stored.
    const command = harnesses.get(id).command
    return command && existsSync(command) ? command : null
  },

  isRunnableWithoutCatalog(id) {
    if (id === 'claude') return isClaudeRuntimeRunnable()
    if (id === 'codex') return isCodexBinaryOverrideRunnable()
    if (id === 'acp-grok') return envBinaryExists('SUPERONE_ACP_BINARY')
    return envBinaryExists('SUPERONE_OPENCODE_BINARY')
  },

  autoRuntime(id): ResolvedAutoRuntime | null {
    if (id === 'claude') {
      const sdk = resolveSdkClaudeBinary()
      if (sdk && existsSync(sdk)) return { command: sdk, source: 'agent-sdk-optional' }
      return null
    }
    // codex: env pin or PATH
    const fromEnv = resolveCodexBinaryPath({})
    if (fromEnv) return { command: fromEnv, source: 'env-or-catalog' }
    const fromPath = resolveExternalCommand(undefined, ['codex'])
    if (fromPath) return { command: fromPath, source: 'path' }
    return null
  },
}

/** Provider-credential auth probe backed by the node's ProviderStore. */
export function cliHarnessAuthProbe(
  providers: ProviderStore | null | undefined,
): HarnessAuthProbe | null {
  if (!providers) return null
  return {
    hasCredentialFor(id) {
      const consumer = consumerForHarness(id)
      if (!consumer) return null
      const binding = providers.listBindings().find((b) => b.consumer === consumer)
      if (binding?.credentialId) {
        const cred = providers.listCredentials().find((c) => c.id === binding.credentialId)
        if (cred) return { ok: true, reason: `provider binding ${consumer}` }
      }
      // Any credential that can serve this harness consumer family
      if (providers.listCredentials().length > 0) {
        return { ok: true, reason: 'node has provider credentials' }
      }
      return null
    },
  }
}

/** Assemble the kernel dependency bundle for this node. */
export function cliHarnessDeps(providers?: ProviderStore | null): HarnessKernelDeps {
  return {
    home: { root: resolveNodeHome(undefined) },
    releaseVersion: resolveCliReleaseVersion(),
    resolver: cliHarnessResolver,
    installer: createOfficialNpmInstaller(),
    auth: cliHarnessAuthProbe(providers),
  }
}
