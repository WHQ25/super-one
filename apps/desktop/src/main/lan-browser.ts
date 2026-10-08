import makeMdns, { type MdnsAnswer, type MdnsPacket } from 'multicast-dns'
import { networkAddressScope } from '@superone/shared/private-network-address'
import { lanServiceDomain } from './lan-service-type'

/** One DNS-SD service instance found on the LAN. */
export interface LanService {
  instance: string
  port: number
  /** IPv4/IPv6 addresses of the instance's host, plus the address that answered. */
  addresses: string[]
  txt: Record<string, string>
}

const BROWSE_TIMEOUT_MS = 1_500

/**
 * Fold mDNS records into service instances of one type. `sources` maps an
 * instance to the address its answer came from, used when no A/AAAA record
 * for the SRV target arrived.
 */
export function collectLanServices(records: readonly MdnsAnswer[], serviceType: string, sources = new Map<string, string>()): LanService[] {
  const domain = lanServiceDomain(serviceType).toLowerCase()
  const instances = new Set<string>()
  const srv = new Map<string, { port: number; target: string }>()
  const txt = new Map<string, Record<string, string>>()
  const hosts = new Map<string, Set<string>>()
  for (const r of records) {
    const name = r.name.toLowerCase()
    if (r.type === 'PTR' && name === domain && typeof r.data === 'string') instances.add(r.data.toLowerCase())
    else if (r.type === 'SRV' && name.endsWith(`.${domain}`)) {
      const data = r.data as { port?: number; target?: string }
      if (typeof data?.port === 'number' && typeof data.target === 'string') {
        instances.add(name)
        srv.set(name, { port: data.port, target: data.target.toLowerCase() })
      }
    } else if (r.type === 'TXT' && name.endsWith(`.${domain}`)) txt.set(name, parseTxt(r.data))
    else if ((r.type === 'A' || r.type === 'AAAA') && typeof r.data === 'string') {
      const set = hosts.get(name) ?? new Set<string>()
      set.add(r.data)
      hosts.set(name, set)
    }
  }
  const services: LanService[] = []
  for (const instance of instances) {
    const record = srv.get(instance)
    if (!record) continue
    const addresses = new Set(hosts.get(record.target) ?? [])
    const source = sources.get(instance)
    if (source) addresses.add(source)
    services.push({ instance, port: record.port, addresses: [...addresses], txt: txt.get(instance) ?? {} })
  }
  return services
}

function parseTxt(data: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const entries = Array.isArray(data) ? data : [data]
  for (const entry of entries) {
    const text = typeof entry === 'string' ? entry : Buffer.isBuffer(entry) ? entry.toString('utf8') : ''
    const eq = text.indexOf('=')
    if (eq > 0) out[text.slice(0, eq)] = text.slice(eq + 1)
  }
  return out
}

/**
 * Base URLs of a desktop node's LAN advertisement (`node-host-controller.ts`
 * publishes TXT `env=<environmentId>`). Only private, non-Tailscale addresses
 * count as LAN; IPv6 link-local needs a zone and is skipped.
 */
export function nodeLanUrls(services: readonly LanService[], environmentId: string): string[] {
  const urls: string[] = []
  for (const service of services) {
    if (service.txt.env !== environmentId) continue
    const ranked = service.addresses
      .filter((a) => {
        const scope = networkAddressScope(a)
        return scope === 'private' || (scope === 'link-local' && !a.includes(':'))
      })
      .sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')))
    for (const address of ranked) {
      const url = `http://${address.includes(':') ? `[${address}]` : address}:${service.port}`
      if (!urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

/** Ask the LAN for instances of a service type and collect answers for a short window. */
export function browseLanServices(serviceType: string, timeoutMs = BROWSE_TIMEOUT_MS): Promise<LanService[]> {
  return new Promise((resolve) => {
    const records: MdnsAnswer[] = []
    const sources = new Map<string, string>()
    const domain = lanServiceDomain(serviceType)
    let mdns: ReturnType<typeof makeMdns>
    try {
      mdns = makeMdns()
    } catch {
      resolve([])
      return
    }
    const finish = (): void => {
      clearTimeout(timer)
      try {
        mdns.destroy()
      } catch {
        /* already closed */
      }
      resolve(collectLanServices(records, serviceType, sources))
    }
    const timer = setTimeout(finish, timeoutMs)
    mdns.on('error', finish)
    mdns.on('response', (packet: MdnsPacket, rinfo: unknown) => {
      const answers = [...(packet.answers ?? []), ...(packet.additionals ?? [])]
      const from = (rinfo as { address?: string } | undefined)?.address
      for (const r of answers) {
        records.push(r)
        if (from && r.type === 'SRV' && r.name.toLowerCase().endsWith(`.${domain.toLowerCase()}`)) {
          sources.set(r.name.toLowerCase(), from)
        }
      }
      // Instances answered by PTR alone still need their SRV/TXT.
      const missing = answers
        .filter((r) => r.type === 'PTR' && typeof r.data === 'string')
        .map((r) => r.data as string)
        .filter((instance) => !answers.some((a) => a.type === 'SRV' && a.name === instance))
      if (missing.length > 0) {
        mdns.query({ questions: missing.flatMap((name) => [{ name, type: 'SRV' }, { name, type: 'TXT' }]) })
      }
    })
    mdns.query({ questions: [{ name: domain, type: 'PTR' }] })
  })
}
