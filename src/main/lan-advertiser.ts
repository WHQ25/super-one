import { spawn, type ChildProcess } from 'node:child_process'
import { Bonjour } from 'bonjour-service'
import log from './logger'

export const LAN_SERVICE_TYPE = 'superone'
export const LAN_SERVICE_FQDN = `_${LAN_SERVICE_TYPE}._tcp`

export interface LanAdvertisement {
  name: string
  port: number
  txt: Record<string, string>
}

interface Backend {
  publish(ad: LanAdvertisement): void
  unpublish(): void
  isPublishing(): boolean
}

const liveDnsSdProcs = new Set<ChildProcess>()
let exitHandlerInstalled = false

function ensureExitHandlerInstalled(): void {
  if (exitHandlerInstalled) return
  exitHandlerInstalled = true
  const killAll = (): void => {
    for (const p of liveDnsSdProcs) {
      try { p.kill('SIGTERM') } catch { /* ignore */ }
    }
    liveDnsSdProcs.clear()
  }
  process.on('exit', killAll)
  process.on('SIGINT', () => { killAll(); process.exit(130) })
  process.on('SIGTERM', () => { killAll(); process.exit(143) })
}

class DnsSdBackend implements Backend {
  private proc: ChildProcess | null = null

  publish(ad: LanAdvertisement): void {
    this.unpublish()
    ensureExitHandlerInstalled()
    const txtArgs = Object.entries(ad.txt).map(([k, v]) => `${k}=${v}`)
    const args = ['-R', ad.name, LAN_SERVICE_FQDN, 'local', String(ad.port), ...txtArgs]
    try {
      const proc = spawn('dns-sd', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      this.proc = proc
      liveDnsSdProcs.add(proc)
      proc.on('exit', (code, signal) => {
        log.info(`[LanAdvertiser] dns-sd exited code=${code} signal=${signal}`)
        liveDnsSdProcs.delete(proc)
        if (this.proc === proc) this.proc = null
      })
      proc.on('error', (err) => {
        log.error('[LanAdvertiser] dns-sd spawn error:', err)
        liveDnsSdProcs.delete(proc)
        if (this.proc === proc) this.proc = null
      })
      log.info(`[LanAdvertiser] dns-sd -R ${ad.name} ${LAN_SERVICE_FQDN} local ${ad.port} ${txtArgs.join(' ')}`)
    } catch (err) {
      log.error('[LanAdvertiser] dns-sd spawn failed:', err)
      this.proc = null
    }
  }

  unpublish(): void {
    const proc = this.proc
    this.proc = null
    if (!proc) return
    liveDnsSdProcs.delete(proc)
    try {
      proc.kill('SIGTERM')
    } catch (err) {
      log.error('[LanAdvertiser] dns-sd kill failed:', err)
    }
  }

  isPublishing(): boolean {
    return this.proc !== null
  }
}

class BonjourBackend implements Backend {
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
      log.info(`[LanAdvertiser] bonjour published _${LAN_SERVICE_TYPE}._tcp port=${ad.port}`)
    } catch (err) {
      log.error('[LanAdvertiser] bonjour publish failed:', err)
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
      log.error('[LanAdvertiser] bonjour unpublish failed:', err)
    }
  }

  isPublishing(): boolean {
    return this.hasService
  }
}

function makeBackend(): Backend {
  if (process.platform === 'darwin') return new DnsSdBackend()
  return new BonjourBackend()
}

export class LanAdvertiser {
  private backend: Backend = makeBackend()

  publish(ad: LanAdvertisement): void {
    this.backend.publish(ad)
  }

  unpublish(): void {
    this.backend.unpublish()
  }

  isPublishing(): boolean {
    return this.backend.isPublishing()
  }
}
