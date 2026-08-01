import { describe, expect, it } from 'vitest'
import {
  formatSshHostDisplay,
  isWildcardHostToken,
  parseSshConfig,
  collectIncludePaths,
} from './ssh-config'

describe('isWildcardHostToken', () => {
  it('flags globs and negations', () => {
    expect(isWildcardHostToken('*')).toBe(true)
    expect(isWildcardHostToken('*.example.com')).toBe(true)
    expect(isWildcardHostToken('!github.com')).toBe(true)
    expect(isWildcardHostToken('lab')).toBe(false)
  })
})

describe('parseSshConfig', () => {
  it('extracts concrete hosts and skips Host *', () => {
    const hosts = parseSshConfig(`
Host *
  ServerAliveInterval 60

Host lab superone-lab
  HostName 127.0.0.1
  User superone
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host github.com
  User git
`)
    expect(hosts.map((h) => h.alias).sort()).toEqual(['github.com', 'lab', 'superone-lab'])
    const lab = hosts.find((h) => h.alias === 'lab')!
    expect(lab.hostName).toBe('127.0.0.1')
    expect(lab.user).toBe('superone')
    expect(lab.port).toBe(2222)
    expect(lab.display).toBe('superone@127.0.0.1:2222')
    expect(lab.identityFile).toContain('.ssh/id_ed25519')
  })

  it('ignores Match blocks', () => {
    const hosts = parseSshConfig(`
Host real
  HostName example.com

Match host foo
  User nobody

Host after
  HostName after.example
`)
    expect(hosts.map((h) => h.alias).sort()).toEqual(['after', 'real'])
    expect(hosts.find((h) => h.alias === 'after')!.user).toBeUndefined()
  })
})

describe('formatSshHostDisplay', () => {
  it('omits default port 22', () => {
    expect(formatSshHostDisplay({ alias: 'x', hostName: 'h', user: 'u', port: 22 })).toBe('u@h')
  })
})

describe('collectIncludePaths', () => {
  it('resolves relative includes against the config directory', () => {
    const paths = collectIncludePaths('Include config.d/*\nInclude /etc/ssh/extra', '/home/u/.ssh')
    expect(paths[0]).toContain('config.d')
    expect(paths[1]).toBe('/etc/ssh/extra')
  })
})
