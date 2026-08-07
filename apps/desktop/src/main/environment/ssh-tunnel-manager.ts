import type { ChildProcess } from 'node:child_process'
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

export type TunnelReadiness = (localBaseUrl: string) => Promise<void>

export interface EnsureTunnelOptions {
  /**
   * Process-alive is necessary but not sufficient. When provided, existing and
   * newly spawned tunnels must pass this HTTP readiness check before reuse.
   */
  readiness?: TunnelReadiness
}

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
  private readonly inflight = new Map<string, Promise<string>>()
  /** Bumped on close/adopt so a late starter completion cannot repopulate the map. */
  private readonly generation = new Map<string, number>()

  constructor(private readonly starter: ForwardStarter = defaultStarter) {}

  /**
   * Return a loopback base URL for this connection, reusing a live tunnel when
   * its spec is unchanged, the ssh process is still running, and optional HTTP
   * readiness succeeds.
   */
  async ensure(
    connectionId: string,
    spec: SshTunnelSpec,
    options?: EnsureTunnelOptions,
  ): Promise<string> {
    const pending = this.inflight.get(connectionId)
    if (pending) return pending

    const work = this.ensureOnce(connectionId, spec, options).finally(() => {
      if (this.inflight.get(connectionId) === work) {
        this.inflight.delete(connectionId)
      }
    })
    this.inflight.set(connectionId, work)
    return work
  }

  private async ensureOnce(
    connectionId: string,
    spec: SshTunnelSpec,
    options?: EnsureTunnelOptions,
  ): Promise<string> {
    const existing = this.live.get(connectionId)
    if (existing && sameSpec(existing.spec, spec) && isSshProcessAlive(existing.handle.process)) {
      if (!options?.readiness) return existing.handle.localBaseUrl
      try {
        await options.readiness(existing.handle.localBaseUrl)
        return existing.handle.localBaseUrl
      } catch {
        // Stale half-open forward: rebuild.
        this.live.delete(connectionId)
        try {
          existing.handle.stop()
        } catch {
          /* already gone */
        }
      }
    } else if (existing) {
      this.live.delete(connectionId)
      try {
        existing.handle.stop()
      } catch {
        /* already gone */
      }
    }

    const gen = (this.generation.get(connectionId) ?? 0) + 1
    this.generation.set(connectionId, gen)

    const handle = await this.starter({
      destination: spec.destination,
      remotePort: spec.remotePort,
      extraArgs: sshArgsForSpec(spec),
    })

    if ((this.generation.get(connectionId) ?? 0) !== gen) {
      try {
        handle.stop()
      } catch {
        /* already gone */
      }
      throw new Error(`ssh tunnel ensure aborted for ${connectionId}`)
    }

    if (options?.readiness) {
      try {
        await options.readiness(handle.localBaseUrl)
      } catch (err) {
        try {
          handle.stop()
        } catch {
          /* ignore */
        }
        throw err instanceof Error
          ? err
          : new Error(`ssh tunnel readiness failed for ${connectionId}`)
      }
      if ((this.generation.get(connectionId) ?? 0) !== gen) {
        try {
          handle.stop()
        } catch {
          /* ignore */
        }
        throw new Error(`ssh tunnel ensure aborted for ${connectionId}`)
      }
    }

    this.attachLive(connectionId, handle, spec)
    return handle.localBaseUrl
  }

  /**
   * Adopt a tunnel opened elsewhere (e.g. during SSH bootstrap) so it is not leaked.
   * Invalidates any in-flight ensure so a late starter cannot overwrite the adopt.
   */
  adopt(connectionId: string, handle: SshForwardHandle, spec: SshTunnelSpec): void {
    this.bumpGeneration(connectionId)
    this.inflight.delete(connectionId)
    const existing = this.live.get(connectionId)
    if (existing && existing.handle !== handle) {
      try {
        existing.handle.stop()
      } catch {
        /* already gone */
      }
    }
    this.attachLive(connectionId, handle, spec)
  }

  baseUrl(connectionId: string): string | null {
    return this.live.get(connectionId)?.handle.localBaseUrl ?? null
  }

  has(connectionId: string): boolean {
    return this.live.has(connectionId)
  }

  close(connectionId: string): void {
    this.bumpGeneration(connectionId)
    this.inflight.delete(connectionId)
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
    const ids = new Set<string>([...this.live.keys(), ...this.inflight.keys()])
    for (const id of ids) this.close(id)
  }

  private bumpGeneration(connectionId: string): void {
    this.generation.set(connectionId, (this.generation.get(connectionId) ?? 0) + 1)
  }

  private attachLive(connectionId: string, handle: SshForwardHandle, spec: SshTunnelSpec): void {
    this.live.set(connectionId, { handle, spec })
    handle.process.once('exit', () => {
      const cur = this.live.get(connectionId)
      if (cur?.handle === handle) {
        this.live.delete(connectionId)
      }
    })
  }
}

/** True while the ChildProcess has neither been signaled by us nor exited on its own. */
export function isSshProcessAlive(process: ChildProcess): boolean {
  return !process.killed && process.exitCode === null && process.signalCode === null
}

function sameSpec(a: SshTunnelSpec, b: SshTunnelSpec): boolean {
  return (
    a.destination === b.destination &&
    a.remotePort === b.remotePort &&
    a.sshPort === b.sshPort &&
    a.identityFile === b.identityFile
  )
}
