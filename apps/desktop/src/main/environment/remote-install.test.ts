import { describe, expect, it } from 'vitest'
import {
  distTargetFor,
  MIN_REMOTE_NODE_MAJOR,
  parseProbeOutput,
  preflightBlocker,
  type RemoteHostProbe,
} from './remote-install'

function probeOutput(lines: Record<string, string>): string {
  return [
    'SUPERONE_PROBE_BEGIN',
    ...Object.entries(lines).map(([k, v]) => `${k}=${v}`),
    'SUPERONE_PROBE_END',
  ].join('\n')
}

describe('remote host probe parsing', () => {
  it('maps a glibc x86_64 Linux host to the linux-x64 artifact', () => {
    const probe = parseProbeOutput(
      probeOutput({
        os: 'Linux',
        arch: 'x86_64',
        home: '/home/superone',
        musl: '0',
        superone: '',
        node_major: '22',
        systemd: '1',
      }),
    )

    expect(probe.os).toBe('linux')
    expect(probe.arch).toBe('x64')
    expect(probe.musl).toBe(false)
    expect(probe.distTarget).toBe('linux-x64')
    expect(probe.nodeMajor).toBe(22)
    expect(probe.hasSystemd).toBe(true)
    expect(probe.superonePath).toBeNull()
  })

  it('selects the musl artifact on Alpine', () => {
    const probe = parseProbeOutput(
      probeOutput({ os: 'Linux', arch: 'aarch64', home: '/root', musl: '1', node_major: '20' }),
    )

    expect(probe.arch).toBe('arm64')
    expect(probe.musl).toBe(true)
    expect(probe.distTarget).toBe('linuxmusl-arm64')
  })

  it('reports an existing installation and its version', () => {
    const probe = parseProbeOutput(
      probeOutput({
        os: 'Linux',
        arch: 'x86_64',
        home: '/home/u',
        musl: '0',
        superone: '/home/u/.superone/current/bin/superone',
        superone_version: '0.49.4-alpha',
        node_major: '24',
        systemd: '1',
      }),
    )

    expect(probe.superonePath).toBe('/home/u/.superone/current/bin/superone')
    expect(probe.superoneVersion).toBe('0.49.4-alpha')
  })

  it('reports a missing Node runtime as null rather than zero', () => {
    const probe = parseProbeOutput(
      probeOutput({ os: 'Linux', arch: 'x86_64', home: '/home/u', musl: '0', node_major: '' }),
    )

    expect(probe.nodeMajor).toBeNull()
  })

  it('leaves an unrecognised platform without an artifact target', () => {
    const probe = parseProbeOutput(
      probeOutput({ os: 'FreeBSD', arch: 'riscv64', home: '/home/u', musl: '0', node_major: '22' }),
    )

    expect(probe.os).toBe('unknown')
    expect(probe.arch).toBe('unknown')
    expect(probe.distTarget).toBeNull()
  })
})

describe('artifact target mapping', () => {
  it('covers every platform/arch/libc combination we build', () => {
    expect(distTargetFor('linux', 'x64', false)).toBe('linux-x64')
    expect(distTargetFor('linux', 'arm64', false)).toBe('linux-arm64')
    expect(distTargetFor('linux', 'x64', true)).toBe('linuxmusl-x64')
    expect(distTargetFor('darwin', 'arm64', false)).toBe('darwin-arm64')
    expect(distTargetFor('unknown', 'x64', false)).toBeNull()
    expect(distTargetFor('linux', 'unknown', false)).toBeNull()
  })
})

describe('preflight', () => {
  const base: RemoteHostProbe = {
    os: 'linux',
    arch: 'x64',
    musl: false,
    home: '/home/superone',
    superonePath: null,
    superoneVersion: null,
    nodeMajor: 22,
    hasNpm: true,
    hasSystemd: true,
    distTarget: 'linux-x64',
  }

  it('accepts a supported host for registry install', () => {
    expect(preflightBlocker(base, 'registry')).toBeNull()
  })

  it('blocks registry install when npm is missing', () => {
    expect(preflightBlocker({ ...base, hasNpm: false }, 'registry')).toContain('npm is required')
  })

  it('allows upload install without npm when a dist target exists', () => {
    expect(preflightBlocker({ ...base, hasNpm: false }, 'upload')).toBeNull()
  })

  it('blocks when the remote has no Node runtime', () => {
    expect(preflightBlocker({ ...base, nodeMajor: null })).toContain('was not found on PATH')
  })

  it('blocks and names the found version when Node is too old', () => {
    const blocker = preflightBlocker({ ...base, nodeMajor: 16 })
    expect(blocker).toContain(String(MIN_REMOTE_NODE_MAJOR))
    expect(blocker).toContain('found 16')
  })

  it('blocks an unsupported architecture', () => {
    expect(preflightBlocker({ ...base, arch: 'unknown', distTarget: null })).toContain(
      'unsupported remote CPU architecture',
    )
  })

  it('blocks when $HOME could not be resolved', () => {
    expect(preflightBlocker({ ...base, home: '' })).toContain('$HOME')
  })

  it('does not block a host without systemd — persistence is a warning, not a failure', () => {
    expect(preflightBlocker({ ...base, hasSystemd: false })).toBeNull()
  })
})
