import { describe, expect, it } from 'vitest'
import { isPrivateNetworkAddress, networkAddressScope } from './private-network-address'

describe('networkAddressScope', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['::1', 'loopback'],
    ['[::1]', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.20', 'private'],
    ['169.254.10.1', 'link-local'],
    ['fe80::1', 'link-local'],
    ['fe80::1%en0', 'link-local'],
    ['febf::1', 'link-local'],
    ['fd12:3456::1', 'private'],
    ['fd7a:115c:a1e1::1', 'private'],
    ['fc00::1', 'private'],
    ['100.64.0.1', 'tailscale'],
    ['100.101.102.103', 'tailscale'],
    ['100.127.255.255', 'tailscale'],
    ['fd7a:115c:a1e0::1', 'tailscale'],
    ['fd7a:115c:a1e0:ab12:4843:cd96:6258:b240', 'tailscale'],
  ] as const)('%s is %s', (address, scope) => {
    expect(networkAddressScope(address)).toBe(scope)
    expect(isPrivateNetworkAddress(address)).toBe(true)
  })

  it.each([
    ['::ffff:192.168.1.5', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:100.80.1.1', 'tailscale'],
    ['::ffff:c0a8:0105', 'private'],
    ['0:0:0:0:0:ffff:a00:1', 'private'],
  ] as const)('reads the IPv4-mapped form %s as %s', (address, scope) => {
    expect(networkAddressScope(address)).toBe(scope)
  })

  it.each([
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '169.255.0.1',
    '2001:4860:4860::8888',
    'fe00::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '0.0.0.0',
    '::',
  ])('%s is public', (address) => {
    expect(networkAddressScope(address)).toBe('public')
    expect(isPrivateNetworkAddress(address)).toBe(false)
  })

  it.each([undefined, null, '', 'localhost', 'host.local', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1::2::3', 'g::1', '1:2:3:4:5:6:7:8:9'])(
    'fails closed on %s',
    (address) => {
      expect(isPrivateNetworkAddress(address)).toBe(false)
    },
  )
})
