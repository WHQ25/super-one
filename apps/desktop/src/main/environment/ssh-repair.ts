/**
 * Re-pair an existing SSH-reachable node without user-supplied secrets.
 *
 * A node that blocks on `auth` / `revoked` needs a fresh pairing token, and the
 * only affordance used to be two `window.prompt`s asking the user to SSH in, run
 * `pair-create` by hand, and figure out the tunnel's local base URL. Users
 * predictably chose "Add remote host over SSH" instead — which mints a new
 * connectionId, so the same host reappears as a different project entry.
 *
 * The desktop already knows the SSH destination, so it can do all of that
 * itself. Identity is still verified inside `repairPairing`: environmentId and
 * node fingerprint must match what was pinned, or the re-pair is rejected.
 */
import {
  selectSshRepairProfile,
  sshArgsForSpec,
  tunnelSpecFromEndpoint,
  type EndpointProfile,
  type EnvironmentInstallProgress,
  type ExecutionEnvironmentDescriptor,
  type SshTunnelSpec,
} from '@superone/shared/environment'
import type { RemoteHostProbe, SshTarget } from './remote-install'
import { buildBootstrapCommand, extractJsonObject } from './ssh-bootstrap'

// Re-export for existing main-process call sites / tests.
export { selectSshRepairProfile }

export interface SshRepairDeps {
  probeHost: (target: SshTarget) => Promise<RemoteHostProbe>
  sshCapture: (input: {
    destination: string
    command: string
    extraArgs?: string[]
    timeoutMs?: number
  }) => Promise<{ stdout: string; stderr: string; code: number | null }>
  ensureTunnel: (spec: SshTunnelSpec) => Promise<string>
  repairPairing: (input: {
    connectionId: string
    baseUrl: string
    pairingToken: string
  }) => Promise<ExecutionEnvironmentDescriptor>
}

export interface SshRepairTarget {
  connectionId: string
  endpointProfiles: EndpointProfile[]
  preferredEndpointId?: string
}

const PAIR_CREATE_TIMEOUT_MS = 120_000

export async function repairPairingOverSsh(
  target: SshRepairTarget,
  deps: SshRepairDeps,
  onProgress?: (progress: EnvironmentInstallProgress) => void,
): Promise<ExecutionEnvironmentDescriptor> {
  const profile = selectSshRepairProfile(target.endpointProfiles, target.preferredEndpointId)
  const spec = profile ? tunnelSpecFromEndpoint(profile) : null
  if (!profile || !spec) {
    throw Object.assign(
      new Error(
        'This node was paired without an SSH endpoint, so the desktop cannot mint a ' +
          'pairing token on it. Run `superone pair-create` on the host and use manual repair.',
      ),
      { code: 'failed_precondition' },
    )
  }

  const sshTarget: SshTarget = {
    destination: spec.destination,
    extraSshArgs: sshArgsForSpec(spec),
  }

  // Prefer admin metadata stored at pair time so custom node homes / non-PATH
  // installs repair the same store the user originally paired. Fall back to a
  // host probe for legacy profiles that only stored destination/port.
  //
  // nodeBinDir is required for nvm-style hosts: the packaged launcher is
  // `#!/usr/bin/env node` and a non-login SSH shell will not have the
  // version-manager bin on PATH unless we re-export it. An empty string means
  // "system Node is fine" and is distinct from "field never persisted".
  let remoteExec = profile.ssh?.remoteExec?.trim() || ''
  let remoteNodeHome = profile.ssh?.remoteNodeHome?.trim() || ''
  const nodeBinDirStored = typeof profile.ssh?.nodeBinDir === 'string'
  let nodeBinDir = nodeBinDirStored ? profile.ssh!.nodeBinDir!.trim() : ''
  const hasCompleteAdminStore =
    Boolean(remoteExec) && Boolean(remoteNodeHome) && nodeBinDirStored

  if (!hasCompleteAdminStore) {
    onProgress?.({ phase: 'probing' })
    const probe = await deps.probeHost(sshTarget)
    if (!remoteExec) {
      if (!probe.superonePath) {
        throw Object.assign(
          new Error(
            `No SuperOne CLI found on ${spec.destination}. Install it on the host ` +
              '(`npm install -g @super-one/cli@alpha`) before repairing the pairing.',
          ),
          { code: 'failed_precondition' },
        )
      }
      remoteExec = probe.superonePath
    }
    if (!remoteNodeHome) {
      remoteNodeHome = `${probe.home}/.superone/node`
    }
    if (!nodeBinDirStored) {
      nodeBinDir = probe.nodeBinDir?.trim() || ''
    }
  }

  // The tunnel's local port is ephemeral, so a stored baseUrl is never reusable
  // after a restart — rebuild (or reuse a live one) before talking to the node.
  onProgress?.({ phase: 'starting' })
  const baseUrl = await deps.ensureTunnel(spec)

  onProgress?.({ phase: 'pairing' })
  // Same batched command as first-time bootstrap: start only if unhealthy, then
  // mint the token against the (stored or default) node home.
  const command = buildBootstrapCommand({
    remoteExec,
    remoteNodeHome,
    remotePort: spec.remotePort,
    nodeBinDir,
  })
  const out = await deps.sshCapture({
    destination: spec.destination,
    command,
    extraArgs: sshTarget.extraSshArgs,
    timeoutMs: PAIR_CREATE_TIMEOUT_MS,
  })
  if (out.code !== 0) {
    // stderr only: stdout carries the pairing token on the success path.
    throw new Error(`pair-create failed on ${spec.destination}: ${out.stderr.trim() || `exit ${out.code}`}`)
  }
  const parsed = extractJsonObject(out.stdout)
  const pairingToken = typeof parsed?.pairingToken === 'string' ? parsed.pairingToken : ''
  if (!pairingToken) {
    throw new Error(`pair-create did not return a pairing token from ${spec.destination}`)
  }

  return deps.repairPairing({
    connectionId: target.connectionId,
    baseUrl,
    pairingToken,
  })
}
