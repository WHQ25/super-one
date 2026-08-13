import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { hostname, networkInterfaces } from 'os'
import makeMdns, { type MdnsAnswer, type MdnsInstance, type MdnsQuestion } from 'multicast-dns'
import log from './logger'
import { ProcessTitle } from './process-titles'

export const LAN_SERVICE_TYPE = 'superone'
export const LAN_SERVICE_FQDN = `_${LAN_SERVICE_TYPE}._tcp`
const LAN_SERVICE_DOMAIN = `${LAN_SERVICE_FQDN}.local`
const SRV_TTL = 120
const PTR_TTL = 4500

export interface LanAdvertisement {
  name: string
  port: number
  txt: Record<string, string>
}

export interface AdvertiserStrategy {
  publish(ad: LanAdvertisement): Promise<void>
  unpublish(): Promise<void>
  isPublishing(): boolean
}

export class LanAdvertiser {
  private strategy: AdvertiserStrategy
  private currentAd: LanAdvertisement | null = null

  constructor(strategy?: AdvertiserStrategy) {
    this.strategy = strategy ?? (process.platform === 'darwin'
      ? new DnsSdStrategy()
      : new MulticastDnsStrategy())
  }

  async publish(ad: LanAdvertisement): Promise<void> {
    if (this.currentAd && advertisementEqual(this.currentAd, ad) && this.strategy.isPublishing()) {
      return
    }
    await this.strategy.unpublish()
    try {
      await this.strategy.publish(ad)
      this.currentAd = ad
    } catch (err) {
      log.error('[LanAdvertiser] publish failed:', err)
      this.currentAd = null
      await this.strategy.unpublish().catch(() => {})
      throw err
    }
  }

  async unpublish(): Promise<void> {
    this.currentAd = null
    await this.strategy.unpublish()
  }

  isPublishing(): boolean {
    return this.strategy.isPublishing()
  }
}

function advertisementEqual(a: LanAdvertisement, b: LanAdvertisement): boolean {
  if (a.name !== b.name || a.port !== b.port) return false
  const ak = Object.keys(a.txt)
  const bk = Object.keys(b.txt)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (a.txt[k] !== b.txt[k]) return false
  return true
}

type DnsSdChild = ChildProcessByStdio<null, Readable, Readable>

class DnsSdStrategy implements AdvertiserStrategy {
  private child: DnsSdChild | null = null

  publish(ad: LanAdvertisement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const txtArgs = Object.entries(ad.txt).map(([k, v]) => `${k}=${v}`)
      const args = [
        '-R',
        ad.name,
        LAN_SERVICE_FQDN,
        'local',
        String(ad.port),
        ...txtArgs,
      ]
      const child: DnsSdChild = spawn('/usr/bin/dns-sd', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        argv0: ProcessTitle.Mdns,
      })
      this.child = child

      let settled = false
      const settle = (err?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        if (err) reject(err)
        else resolve()
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        if (!settled && text.includes('Name now registered and active')) {
          log.info(`[LanAdvertiser] dns-sd registered ${ad.name}.${LAN_SERVICE_DOMAIN} port=${ad.port}`)
          settle()
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim()
        if (text) log.warn('[LanAdvertiser] dns-sd stderr:', text)
        if (!settled && /failed/i.test(text)) settle(new Error(`dns-sd failed: ${text}`))
      })
      child.once('exit', (code, signal) => {
        if (this.child === child) this.child = null
        if (!settled) settle(new Error(`dns-sd exited prematurely (code=${code} signal=${signal})`))
      })
      child.once('error', (err) => {
        if (this.child === child) this.child = null
        settle(err)
      })

      const timeoutId = setTimeout(() => settle(new Error('dns-sd register timed out')), 3000)
    })
  }

  unpublish(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let resolved = false
      const finish = (): void => {
        if (resolved) return
        resolved = true
        clearTimeout(killTimer)
        resolve()
      }
      child.once('exit', finish)
      try {
        child.kill('SIGTERM')
      } catch (err) {
        log.error('[LanAdvertiser] dns-sd SIGTERM failed:', err)
        finish()
        return
      }
      const killTimer = setTimeout(() => {
        if (resolved) return
        try { child.kill('SIGKILL') } catch { /* noop */ }
        finish()
      }, 800)
    })
  }

  isPublishing(): boolean {
    return this.child !== null && this.child.exitCode === null
  }
}

class MulticastDnsStrategy implements AdvertiserStrategy {
  private mdns: MdnsInstance | null = null
  private records: MdnsAnswer[] | null = null

  publish(ad: LanAdvertisement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const mdns = makeMdns()
      const records = buildRecords(ad)

      const onError = (err: Error): void => {
        mdns.removeListener('ready', onReady)
        try { mdns.destroy() } catch { /* noop */ }
        reject(err)
      }
      const onReady = (): void => {
        mdns.removeListener('error', onError)
        mdns.on('query', (packet) => this.handleQuery(packet.questions ?? []))

        try {
          mdns.respond({ answers: records })
          setTimeout(() => {
            try { this.mdns?.respond({ answers: records }) } catch { /* noop */ }
          }, 1000)
        } catch (err) {
          log.warn('[LanAdvertiser] mdns initial announce failed:', err)
        }

        this.mdns = mdns
        this.records = records
        log.info(`[LanAdvertiser] multicast-dns published ${ad.name}.${LAN_SERVICE_DOMAIN} port=${ad.port}`)
        resolve()
      }

      mdns.once('error', onError)
      mdns.once('ready', onReady)
    })
  }

  private handleQuery(questions: MdnsQuestion[]): void {
    const records = this.records
    const mdns = this.mdns
    if (!records || !mdns || questions.length === 0) return
    const matched: MdnsAnswer[] = []
    for (const q of questions) {
      for (const r of records) {
        if (questionMatchesRecord(q, r)) matched.push(r)
      }
    }
    if (matched.length === 0) return
    try {
      mdns.respond({ answers: matched })
    } catch (err) {
      log.warn('[LanAdvertiser] mdns respond failed:', err)
    }
  }

  unpublish(): Promise<void> {
    const mdns = this.mdns
    const records = this.records
    this.mdns = null
    this.records = null
    if (!mdns) return Promise.resolve()

    return new Promise<void>((resolve) => {
      let resolved = false
      const finish = (): void => {
        if (resolved) return
        resolved = true
        clearTimeout(hardTimeout)
        try { mdns.destroy() } catch { /* noop */ }
        resolve()
      }
      try {
        mdns.removeAllListeners('query')
      } catch { /* noop */ }
      try {
        if (records) {
          const goodbye: MdnsAnswer[] = records.map((r) => ({ ...r, ttl: 0 }))
          mdns.respond({ answers: goodbye }, () => setTimeout(finish, 200))
        } else {
          finish()
        }
      } catch (err) {
        log.warn('[LanAdvertiser] mdns goodbye failed:', err)
        finish()
      }
      const hardTimeout = setTimeout(finish, 800)
    })
  }

  isPublishing(): boolean {
    return this.mdns !== null
  }
}

export function buildRecords(ad: LanAdvertisement): MdnsAnswer[] {
  const instance = `${ad.name}.${LAN_SERVICE_DOMAIN}`
  const target = preferredHostname()
  return [
    { name: LAN_SERVICE_DOMAIN, type: 'PTR', ttl: PTR_TTL, data: instance },
    {
      name: instance,
      type: 'SRV',
      ttl: SRV_TTL,
      data: { port: ad.port, weight: 0, priority: 10, target },
    },
    {
      name: instance,
      type: 'TXT',
      ttl: SRV_TTL,
      data: Object.entries(ad.txt).map(([k, v]) => Buffer.from(`${k}=${v}`)),
    },
  ]
}

function questionMatchesRecord(q: MdnsQuestion, r: MdnsAnswer): boolean {
  if (q.name.toLowerCase() !== r.name.toLowerCase()) return false
  if (q.type === 'ANY' || q.type === '*') return true
  return q.type === r.type
}

function preferredHostname(): string {
  const host = hostname()
  if (host.endsWith('.local')) return host
  return `${host}.local`
}

export function hasUsableNetworkInterface(): boolean {
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const info of list) {
      if (!info.internal && info.family === 'IPv4') return true
    }
  }
  return false
}
