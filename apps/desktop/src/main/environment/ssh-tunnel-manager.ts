import { sshArgsForSpec, type SshTunnelSpec } from '@superone/shared/environment'
import { startSshLocalForward, type SshForwardHandle } from './ssh-forward'

/**
 * Owns the lifecycle of `ssh -L` local forwards, one per connection.
 *
 * A tunnel is client-local plumbing, not the node's lifecycle: closing it
 * disconnects this desktop but must never stop the remote service (design §11.1).
 * Because the local port is ephemeral, a stored `ssh-forward` endpoint cannot be
 * reconnected by reusing the old baseUrl after an app restart — the tunnel has to
 * be rebuilt first, which is what `ensure()` provides.
 */
export type ForwardStarter = (opts: {
  destination: string
  remotePort: number
  extraArgs?: string[]
}) => Promise<SshForwardHandle>

const defaultStarter: ForwardStarter = (opts) =>
  startSshLocalForward({
    destination: opts.destination,
    remotePort: opts.remotePort,
    extraArgs: opts.extraArgs,
  })

interface LiveTunnel {
  handle: SshForwardHandle
  spec: SshTunnelSpec
}

export class SshTunnelManager {
  private readonly live = new Map<string, LiveTunnel>()

  constructor(private readonly starter: ForwardStarter = defaultStarter) {}

  /**
   * Return a loopback base URL for this connection, reusing a live tunnel when
   * its spec is unchanged and the ssh process is still running.
   */
  async ensure(connectionId: string, spec: SshTunnelSpec): Promise<string> {
    const existing = this.live.get(connectionId)
    if (existing && sameSpec(existing.spec, spec) && !existing.handle.process.killed) {
      return existing.handle.localBaseUrl
    }
    this.close(connectionId)

    const handle = await this.starter({
      destination: spec.destination,
      remotePort: spec.remotePort,
      extraArgs: sshArgsForSpec(spec),
    })
    this.live.set(connectionId, { handle, spec })
    return handle.localBaseUrl
  }

  /** Adopt a tunnel opened elsewhere (e.g. during SSH bootstrap) so it is not leaked. */
  adopt(connectionId: string, handle: SshForwardHandle, spec: SshTunnelSpec): void {
    const existing = this.live.get(connectionId)
    if (existing && existing.handle !== handle) existing.handle.stop()
    this.live.set(connectionId, { handle, spec })
  }

  baseUrl(connectionId: string): string | null {
    return this.live.get(connectionId)?.handle.localBaseUrl ?? null
  }

  has(connectionId: string): boolean {
    return this.live.has(connectionId)
  }

  close(connectionId: string): void {
    const existing = this.live.get(connectionId)
    if (!existing) return
    this.live.delete(connectionId)
    try {
      existing.handle.stop()
    } catch {
      /* already gone */
    }
  }

  closeAll(): void {
    for (const id of [...this.live.keys()]) this.close(id)
  }
}

function sameSpec(a: SshTunnelSpec, b: SshTunnelSpec): boolean {
  return (
    a.destination === b.destination &&
    a.remotePort === b.remotePort &&
    a.sshPort === b.sshPort &&
    a.identityFile === b.identityFile
  )
}
