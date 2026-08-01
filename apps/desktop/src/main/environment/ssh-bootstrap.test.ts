import { describe, expect, it } from 'vitest'
import {
  buildRemoteInstallCommands,
  extractJsonObject,
  shellQuote,
} from './ssh-bootstrap'

describe('ssh-bootstrap helpers', () => {
  it('extracts pairing JSON from noisy ssh stdout without logging secrets elsewhere', () => {
    const token = 'super-secret-pair-token'
    const stdout = [
      'Welcome to Ubuntu',
      'Last login: ...',
      JSON.stringify({
        environmentId: 'env-abc',
        expiresAt: 123,
        pairingToken: token,
      }),
    ].join('\n')
    const parsed = extractJsonObject(stdout)
    expect(parsed).toEqual({
      environmentId: 'env-abc',
      expiresAt: 123,
      pairingToken: token,
    })
  })

  it('quotes unsafe shell segments', () => {
    expect(shellQuote('/opt/superone/bin')).toBe('/opt/superone/bin')
    expect(shellQuote("path with 'quote")).toContain(`'\\''`)
  })

  it('builds install + pair command sequence for remote orchestration', () => {
    const cmds = buildRemoteInstallCommands({
      remoteExec: '/opt/superone/superone',
      nodeHome: '/home/u/.superone/node',
      remotePort: 7788,
    })
    expect(cmds.some((c) => c.includes('install-systemd'))).toBe(true)
    expect(cmds.some((c) => c.includes('pair-create'))).toBe(true)
    expect(cmds.join('\n')).not.toMatch(/pairingToken=/)
  })
})
