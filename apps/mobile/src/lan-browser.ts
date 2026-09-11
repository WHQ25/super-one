import { requireOptionalNativeModule } from 'expo'
import { LAN_SERVICE_TYPE } from '@superone/relay-client'
import { LanServiceCache, type NativeLanRecord } from './lan-service-cache'
import type { LanService } from './device-discovery'

type NativeSubscription = { remove: () => void }

type NativeLanBrowser = {
  start: (serviceType: string) => Promise<void>
  stop: () => Promise<void>
  addListener: (
    event: 'onServicesChanged',
    listener: (payload: { services: NativeLanRecord[] }) => void,
  ) => NativeSubscription
}

const native = requireOptionalNativeModule<NativeLanBrowser>('SuperOneLanBrowser')

/**
 * Long-lived Bonjour browse for desktops on this network.
 *
 * The native module is optional on purpose: a development client built before
 * it existed, or a platform where browsing is unavailable, degrades to relay-only
 * discovery rather than crashing at import time.
 */
export class LanBrowser {
  private readonly cache = new LanServiceCache()
  private subscription: NativeSubscription | null = null
  private starting: Promise<void> | null = null
  private started = false

  constructor(private readonly onCacheUpdated: () => void) {}

  get isSupported(): boolean {
    return native !== null
  }

  /** Idempotent, and safe to call on every refresh — including concurrently. */
  async ensureBrowsing(): Promise<void> {
    if (!native || this.started) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      this.subscription = native.addListener('onServicesChanged', (payload) => {
        if (this.cache.replace(payload.services ?? [])) this.onCacheUpdated()
      })
      try {
        await native.start(LAN_SERVICE_TYPE)
        this.started = true
      } catch {
        // Browsing is a best-effort accelerator; the relay probe still answers.
        this.subscription?.remove()
        this.subscription = null
      }
    })()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  /**
   * Start over with an empty record set. Neither platform re-resolves a service
   * it has already reported, so this is the only way to learn the new port of a
   * desktop that restarted under the same Bonjour name.
   */
  async restartBrowsing(): Promise<void> {
    await this.stop()
    await this.ensureBrowsing()
  }

  lookup(roomId: string): LanService[] {
    return this.cache.lookup(roomId)
  }

  /** Everything currently advertising. For diagnostics; discovery uses lookup. */
  services(): LanService[] {
    return this.cache.list()
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting
    this.subscription?.remove()
    this.subscription = null
    this.started = false
    this.cache.clear()
    await native?.stop().catch(() => {})
  }
}
