import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseProbeOutput,
  preflightBlocker,
  registryNpmInstallInvocation,
  remoteProbeScript,
  withRemoteNodePath,
  type RemoteHostProbe,
} from './remote-install'

function probeOutput(lines: Record<string, string>): string {
  return [
    'SUPERONE_PROBE_BEGIN',
    ...Object.entries(lines).map(([k, v]) => `${k}=${v}`),
    'SUPERONE_PROBE_END',
  ].join('\n')
}

function writeFakeNode(binPath: string, version: string): string {
  mkdirSync(dirname(binPath), { recursive: true })
  writeFileSync(
    binPath,
    [
      '#!/bin/sh',
      `ver='${version}'`,
      'expr=${2-}',
      'case "$1" in',
      "  -v) printf 'v%s\\n' \"$ver\" ;;",
      '  -p)',
      '    case "$expr" in',
      "      *split*) printf '%s\\n' \"${ver%%.*}\" ;;",
      "      *) printf '%s\\n' \"$ver\" ;;",
      '    esac',
      '    ;;',
      '  *)',
      '    if [ -n "$SUPERONE_NODE_EXEC_MARK" ]; then : > "$SUPERONE_NODE_EXEC_MARK"; fi',
      '    exit 0',
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  )
  chmodSync(binPath, 0o755)
  return binPath
}

function runProbe(home: string, extraEnv: Record<string, string> = {}): RemoteHostProbe {
  const bin = join(home, 'bin')
  mkdirSync(bin, { recursive: true })
  const bash = join(bin, 'bash')
  writeFileSync(
    bash,
    [
      '#!/bin/sh',
      'if [ "$1" = "-lc" ]; then',
      '  if [ -n "$SUPERONE_FAKE_LOGIN_NODE" ]; then',
      '    printf "%s\\n" "$SUPERONE_FAKE_LOGIN_NODE"',
      '  fi',
      '  exit 0',
      'fi',
      'exec /bin/bash "$@"',
      '',
    ].join('\n'),
  )
  chmodSync(bash, 0o755)
  const stdout = execFileSync('/bin/bash', ['-c', remoteProbeScript()], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ...extraEnv,
    },
    encoding: 'utf8',
  })
  return parseProbeOutput(stdout)
}

describe('remote host probe parsing', () => {
  it('parses a glibc x86_64 Linux host with a version-manager Node', () => {
    const probe = parseProbeOutput(
      probeOutput({
        os: 'Linux',
        arch: 'x86_64',
        home: '/home/superone',
        superone: '',
        node_major: '22',
        node_path: '/root/.nvm/versions/node/v22.22.2/bin/node',
        node_bin_dir: '/root/.nvm/versions/node/v22.22.2/bin',
        npm_path: '/root/.nvm/versions/node/v22.22.2/bin/npm',
        shell_path: '/root/.nvm/versions/node/v22.22.2/bin:/usr/bin',
        systemd: '1',
      }),
    )

    expect(probe.os).toBe('linux')
    expect(probe.arch).toBe('x64')
    expect(probe.nodeMajor).toBe(22)
    expect(probe.nodePath).toContain('/.nvm/versions/node/')
    expect(probe.nodeBinDir).toContain('/.nvm/versions/node/')
    expect(probe.npmPath).toContain('/npm')
    expect(probe.shellPath).toContain('/usr/bin')
    expect(probe.hasSystemd).toBe(true)
    expect(probe.superonePath).toBeNull()
  })

  it('reports an existing installation and its version', () => {
    const probe = parseProbeOutput(
      probeOutput({
        os: 'Linux',
        arch: 'x86_64',
        home: '/home/u',
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
      probeOutput({ os: 'Linux', arch: 'x86_64', home: '/home/u', node_major: '' }),
    )

    expect(probe.nodeMajor).toBeNull()
  })

  it('marks an unrecognised platform as unknown', () => {
    const probe = parseProbeOutput(
      probeOutput({ os: 'FreeBSD', arch: 'riscv64', home: '/home/u', node_major: '22' }),
    )

    expect(probe.os).toBe('unknown')
    expect(probe.arch).toBe('unknown')
  })
})

describe('preflight', () => {
  const base: RemoteHostProbe = {
    os: 'linux',
    arch: 'x64',
    home: '/home/superone',
    superonePath: null,
    superoneVersion: null,
    nodeMajor: 22,
    nodeVersion: '22.23.4',
    hasNpm: true,
    hasSystemd: true,
  }

  it('accepts a supported host', () => {
    expect(preflightBlocker(base)).toBeNull()
  })

  it('blocks when npm is missing', () => {
    expect(preflightBlocker({ ...base, hasNpm: false })).toContain('npm is required')
  })

  it('blocks when the remote has no Node runtime', () => {
    expect(
      preflightBlocker({ ...base, nodeMajor: null, nodeVersion: null, shellPath: '/usr/bin' }),
    ).toContain('probe PATH: /usr/bin')
  })

  it('blocks and names the found version when Node is too old', () => {
    const blocker = preflightBlocker({ ...base, nodeMajor: 16, nodeVersion: '16.0.0' })
    expect(blocker).toContain('22.13.0')
    expect(blocker).toContain('found 16')
  })

  it.each(['20.19.2', '22.12.9'])(
    'rejects Node %s',
    (nodeVersion) => {
      const probe = { ...base, nodeMajor: Number(nodeVersion.split('.')[0]), nodeVersion }
      expect(preflightBlocker(probe)).toContain(`found ${nodeVersion}`)
    },
  )

  it.each(['22.13.0', '22.23.4', '24.0.0'])('accepts Node %s', (nodeVersion) => {
    const probe = { ...base, nodeMajor: Number(nodeVersion.split('.')[0]), nodeVersion }
    expect(preflightBlocker(probe)).toBeNull()
  })

  it('asks npm to enforce dependency engines during registry install', () => {
    expect(registryNpmInstallInvocation('/home/u/.superone/npm', '@super-one/cli@0.75.5')).toContain(
      '--engine-strict',
    )
  })

  it('blocks an unsupported architecture', () => {
    expect(preflightBlocker({ ...base, arch: 'unknown' })).toContain(
      'unsupported remote CPU architecture',
    )
  })

  it('blocks when $HOME could not be resolved', () => {
    expect(preflightBlocker({ ...base, home: '' })).toContain('$HOME')
  })

  it('does not block a host without systemd — persistence is a warning, not a failure', () => {
    expect(preflightBlocker({ ...base, hasSystemd: false })).toBeNull()
  })

  it('selects a compatible version-manager Node over an older login Node', () => {
    const home = mkdtempSync(join(tmpdir(), 'superone-probe-'))
    try {
      const oldNode = writeFakeNode(join(home, '.nvm/versions/node/v20.19.2/bin/node'), '20.19.2')
      writeFakeNode(join(home, '.nvm/versions/node/v22.12.9/bin/node'), '22.12.9')
      writeFakeNode(join(home, '.nvm/versions/node/v22.13.0/bin/node'), '22.13.0')
      writeFileSync(join(home, '.nvm/versions/node/v22.13.0/bin/npm'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(home, '.nvm/versions/node/v22.13.0/bin/npm'), 0o755)
      writeFakeNode(join(home, '.nvm/versions/node/v22.23.4/bin/node'), '22.23.4')
      const probe = runProbe(home, { SUPERONE_FAKE_LOGIN_NODE: oldNode })
      expect(probe.nodePath).toContain('/v22.13.0/')
      expect(probe.nodeVersion).toBe('22.13.0')
      expect(preflightBlocker(probe)).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports an incompatible version-manager Node instead of treating Node 20 as enough', () => {
    const home = mkdtempSync(join(tmpdir(), 'superone-probe-'))
    try {
      writeFakeNode(join(home, '.nvm/versions/node/v20.19.2/bin/node'), '20.19.2')
      writeFakeNode(join(home, '.nvm/versions/node/v22.12.9/bin/node'), '22.12.9')
      const probe = runProbe(home)
      expect(probe.nodeVersion === '20.19.2' || probe.nodeVersion === '22.12.9').toBe(true)
      expect(preflightBlocker(probe)).toContain('22.13.0')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('preserves a discovered version-manager Node path in remote commands', () => {
    expect(
      withRemoteNodePath('npm --version', '/root/.nvm/versions/node/v22/bin'),
    ).toBe('export PATH=/root/.nvm/versions/node/v22/bin:$PATH && npm --version')
    expect(withRemoteNodePath('echo ok')).toBe('echo ok')
  })
})
