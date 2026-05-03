import { Bonjour } from 'bonjour-service'
import log from './logger'

export const LAN_SERVICE_TYPE = 'superone'
export const LAN_SERVICE_FQDN = `_${LAN_SERVICE_TYPE}._tcp`

export interface LanAdvertisement {
  name: string
  port: number
  txt: Record<string, string>
}

export class LanAdvertiser {
  private bonjour: Bonjour | null = null
  private hasService = false

  publish(ad: LanAdvertisement): void {
    this.unpublish()
    try {
      this.bonjour = new Bonjour()
      this.bonjour.publish({
        name: ad.name,
        type: LAN_SERVICE_TYPE,
        port: ad.port,
        txt: ad.txt,
      })
      this.hasService = true
      log.info(`[LanAdvertiser] published ${LAN_SERVICE_FQDN} port=${ad.port} name=${ad.name}`)
    } catch (err) {
      log.error('[LanAdvertiser] publish failed:', err)
      this.unpublish()
    }
  }

  unpublish(): void {
    const bonjour = this.bonjour
    this.bonjour = null
    this.hasService = false
    if (!bonjour) return
    try {
      bonjour.unpublishAll(() => bonjour.destroy())
    } catch (err) {
      log.error('[LanAdvertiser] unpublish failed:', err)
    }
  }

  isPublishing(): boolean {
    return this.hasService
  }
}
