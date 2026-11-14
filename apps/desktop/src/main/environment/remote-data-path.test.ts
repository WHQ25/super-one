import { expect, it, vi } from 'vitest'

const variant = vi.hoisted(() => ({ id: 'stable' as 'stable' | 'alpha' | 'dev' }))
vi.mock('../variant', () => ({ variantId: () => variant.id }))

import { assertDevChannelTarget, remoteCliName, remoteNodePort, remoteSuperoneHome, remoteSystemdUnitName } from './remote-data-path'
import { remoteProbeScript } from './remote-install'

it.each([
  ['stable', '/home/u/.superone', 'superone', 7788],
  ['alpha', '/home/u/.superone/alpha', 'superone-alpha', 7790],
  ['dev', '/home/u/.superone/dev', 'superone-dev', 7792],
] as const)('keeps the %s remote installation, command link, port and unit separate', (id, home, cli, port) => {
  variant.id = id
  expect(remoteSuperoneHome('/home/u')).toBe(home)
  expect(remoteCliName()).toBe(cli)
  expect(remoteNodePort()).toBe(port)
  expect(remoteSystemdUnitName()).toBe(`${cli}.service`)
  // Discovery only looks inside this channel's root and command link.
  const probe = remoteProbeScript()
  expect(probe).toContain(`${home.replace('/home/u', '$HOME')}/npm/bin/superone`)
  expect(probe).toContain(`"$HOME/.local/bin/${cli}"`)
  expect(probe).not.toContain('command -v superone ')
})

it('refuses dev operations aimed at stable or alpha nodes', () => {
  const ok = { nodeHome: '/home/u/.superone/dev/node', port: 7792, remoteExec: '/home/u/.superone/dev/npm/bin/superone' }
  expect(() => assertDevChannelTarget(ok)).not.toThrow()
  expect(() => assertDevChannelTarget({ port: 7792, remoteExec: '~/.local/bin/superone-dev' })).not.toThrow()
  expect(() => assertDevChannelTarget({ ...ok, nodeHome: '~/.superone/alpha/node' })).toThrow(/alpha channel/)
  expect(() => assertDevChannelTarget({ ...ok, port: 7790 })).toThrow(/alpha channel/)
  expect(() => assertDevChannelTarget({ ...ok, remoteExec: '/home/u/.superone/alpha/npm/bin/superone' })).toThrow(/alpha channel/)
  expect(() => assertDevChannelTarget({ ...ok, remoteExec: '/home/u/.local/bin/superone' })).toThrow(/stable channel/)
  expect(() => assertDevChannelTarget({ ...ok, nodeHome: '/home/u/.superone/node/' })).toThrow(/stable channel/)
  expect(() => assertDevChannelTarget({ ...ok, port: 7788 })).toThrow(/stable channel/)
})
