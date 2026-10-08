import { describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { buildRecords, NODE_LAN_SERVICE_TYPE } from './lan-advertiser'
import { collectLanServices, nodeLanUrls } from './lan-browser'

describe('collectLanServices', () => {
  it('reads back what the advertiser publishes, with the host address', () => {
    const published = buildRecords({ name: 'superone-node-abc', port: 7791, txt: { env: 'env-1', variant: 'alpha' }, serviceType: NODE_LAN_SERVICE_TYPE })
    const target = (published.find((r) => r.type === 'SRV')!.data as { target: string }).target
    const services = collectLanServices(
      [...published, { name: target, type: 'A', data: '192.168.1.20' }, { name: target, type: 'A', data: '100.70.1.2' }],
      NODE_LAN_SERVICE_TYPE,
    )
    expect(services).toEqual([
      expect.objectContaining({ port: 7791, addresses: ['192.168.1.20', '100.70.1.2'], txt: { env: 'env-1', variant: 'alpha' } }),
    ])
  })

  it('ignores other service types and falls back to the answering address', () => {
    const phone = buildRecords({ name: 'superone-1', port: 50000, txt: { roomId: 'r' } })
    const node = buildRecords({ name: 'n1', port: 7791, txt: { env: 'env-2' }, serviceType: NODE_LAN_SERVICE_TYPE })
    const instance = node.find((r) => r.type === 'SRV')!.name.toLowerCase()
    const services = collectLanServices([...phone, ...node], NODE_LAN_SERVICE_TYPE, new Map([[instance, '10.0.0.5']]))
    expect(services.map((s) => [s.port, s.addresses])).toEqual([[7791, ['10.0.0.5']]])
  })
})

describe('nodeLanUrls', () => {
  const service = (env: string, addresses: string[]) => ({ instance: 'i', port: 7791, addresses, txt: { env } })

  it('matches the paired environment and keeps LAN addresses only, IPv4 first', () => {
    const urls = nodeLanUrls(
      [service('env-1', ['fd00::5', '100.70.1.2', '8.8.8.8', '192.168.1.20', 'fe80::1']), service('env-other', ['192.168.1.30'])],
      'env-1',
    )
    expect(urls).toEqual(['http://192.168.1.20:7791', 'http://[fd00::5]:7791'])
  })

  it('finds nothing for an unknown environment', () => {
    expect(nodeLanUrls([service('env-1', ['192.168.1.20'])], 'env-9')).toEqual([])
  })
})
