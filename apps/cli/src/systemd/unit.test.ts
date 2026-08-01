import { describe, expect, it } from 'vitest'
import { renderSystemdUserUnit } from './unit'

describe('renderSystemdUserUnit', () => {
  it('emits a hardened user unit with explicit HOME and loopback bind', () => {
    const unit = renderSystemdUserUnit({
      execStart: '/opt/superone/superone',
      nodeHome: '/home/user/.superone/node',
      home: '/home/user',
      bindHost: '127.0.0.1',
      bindPort: 7788,
    })
    expect(unit).toContain('WorkingDirectory=/home/user/.superone/node')
    expect(unit).toContain('Environment=HOME=/home/user')
    expect(unit).toContain('SUPERONE_NODE_HOST=127.0.0.1')
    expect(unit).toContain('UMask=0077')
    expect(unit).toContain('KillMode=control-group')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('ExecStart=/opt/superone/superone start --foreground')
  })
})
