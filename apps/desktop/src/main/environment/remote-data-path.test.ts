import { expect, it } from 'vitest'
import { remoteSuperoneHome, remoteCliName } from './remote-data-path'
import { remoteProbeScript } from './remote-install'

it('keeps stable and alpha remote installations and command links separate', () => {
  expect(remoteSuperoneHome('/home/u', '1.0.0')).toBe('/home/u/.superone')
  expect(remoteSuperoneHome('/home/u', '1.0.0-alpha.1')).toBe('/home/u/.superone/alpha')
  expect(remoteCliName('1.0.0')).toBe('superone')
  expect(remoteCliName('1.0.0-alpha.1')).toBe('superone-alpha')
  // Unpackaged desktop follows the alpha distribution channel.
  const probe = remoteProbeScript()
  expect(probe).toContain('$HOME/.superone/alpha/npm/bin/superone')
  expect(probe).not.toContain('command -v superone ')
  expect(probe).not.toContain('"$HOME/.local/bin/superone"')
})
