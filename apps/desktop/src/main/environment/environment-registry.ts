import type {
  EnvironmentGateway,
  EnvironmentRegistry,
  ExecutionEnvironmentDescriptor,
} from '@superone/shared/environment'
import { LocalEnvironmentGateway, type LocalEnvironmentGatewayOptions } from './local-environment-gateway'
import type { NodeConnectionManager } from './node-connection-manager'

/**
 * Main-process registry of environment gateways.
 * Hosts the local gateway and optional remote gateways from NodeConnectionManager.
 */
export class EnvironmentRegistryImpl implements EnvironmentRegistry {
  private readonly local: LocalEnvironmentGateway
  private readonly remotes = new Map<string, EnvironmentGateway>()
  private connectionManager: NodeConnectionManager | null = null

  constructor(localOpts: LocalEnvironmentGatewayOptions) {
    this.local = new LocalEnvironmentGateway(localOpts)
  }

  /** Attach the Phase-1 connection manager so list()/get() see live remotes. */
  setConnectionManager(manager: NodeConnectionManager | null): void {
    this.connectionManager = manager
  }

  getLocal(): LocalEnvironmentGateway {
    return this.local
  }

  get(environmentId: string): EnvironmentGateway | null {
    if (environmentId === this.local.getEnvironmentId()) return this.local
    const fromManager = this.connectionManager?.getGateway(environmentId)
    if (fromManager) return fromManager
    return this.remotes.get(environmentId) ?? null
  }

  /** Register or replace a remote gateway (manual / tests). */
  registerRemote(environmentId: string, gateway: EnvironmentGateway): void {
    if (environmentId === this.local.getEnvironmentId()) {
      throw new Error('cannot register remote gateway over the local environment id')
    }
    this.remotes.set(environmentId, gateway)
  }

  unregisterRemote(environmentId: string): void {
    this.remotes.delete(environmentId)
  }

  async list(): Promise<ExecutionEnvironmentDescriptor[]> {
    const descriptors: ExecutionEnvironmentDescriptor[] = [await this.local.getDescriptor()]
    const seen = new Set<string>([this.local.getEnvironmentId()])

    if (this.connectionManager) {
      for (const known of this.connectionManager.listKnown()) {
        const gw = this.connectionManager.getGateway(known.environmentId)
        if (gw && !seen.has(known.environmentId)) {
          descriptors.push(await gw.getDescriptor())
          seen.add(known.environmentId)
        }
      }
    }

    for (const [environmentId, gateway] of this.remotes) {
      if (seen.has(environmentId)) continue
      descriptors.push(await gateway.getDescriptor())
      seen.add(environmentId)
    }
    return descriptors
  }
}
