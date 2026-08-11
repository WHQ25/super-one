import { describe, expect, it, vi } from 'vitest'
import type { EndpointProfile } from '@superone/shared/environment'
import {
  repairPairingOverSsh,
  selectSshRepairProfile,
  type SshRepairDeps,
} from './ssh-repair'
import type { RemoteHostProbe } from './remote-install'

const SSH_ENDPOINT: EndpointProfile = {
  endpointId: 'ssh',
  kind: 'ssh-forward',
  label: 'SSH: user@host',
  target: 'user@host',
  ssh: { remotePort: 7788, port: 2222, identityFile: '/keys/id_ed25519' },
}

const PROBE: RemoteHostProbe = {
  os: 'linux',
  arch: 'x64',
  musl: false,
  home: '/home/u',
  superonePath: '/home/u/.local/bin/superone',
  superoneVersion: '0.52.0-alpha',
  nodeMajor: 22,
  nodeBinDir: '/home/u/.nvm/versions/node/v22/bin',
} as RemoteHostProbe

function deps(overrides: Partial<SshRepairDeps> = {}): SshRepairDeps {
  return {
    probeHost: vi.fn().mockResolvedValue(PROBE),
    sshCapture: vi.fn().mockResolvedValue({
      stdout: `Welcome to Ubuntu\n${JSON.stringify({
        environmentId: 'env-1',
        pairingToken: 'tok-fresh',
        expiresAt: 999,
      })}`,
      stderr: '',
      code: 0,
    }),
    ensureTunnel: vi.fn().mockResolvedValue('http://127.0.0.1:51234'),
    repairPairing: vi.fn().mockResolvedValue({ environmentId: 'env-1' }),
    ...overrides,
  } as SshRepairDeps
}

describe('selectSshRepairProfile', () => {
  it('prefers the preferred endpoint when it is ssh-forward', () => {
    const preferred: EndpointProfile = {
      endpointId: 'ssh-b',
      kind: 'ssh-forward',
      label: 'B',
      target: 'user@b',
    }
    const other: EndpointProfile = {
      endpointId: 'ssh-a',
      kind: 'ssh-forward',
      label: 'A',
      target: 'user@a',
    }
    expect(selectSshRepairProfile([other, preferred], 'ssh-b')?.endpointId).toBe('ssh-b')
  })

  it('refuses auto-SSH when preferred is non-SSH even if an SSH backup exists', () => {
    const direct: EndpointProfile = {
      endpointId: 'wss',
      kind: 'direct-wss',
      label: 'direct',
      target: 'wss://node',
    }
    // Stale SSH backup must not steal recovery — manual token paste instead.
    expect(selectSshRepairProfile([direct, SSH_ENDPOINT], 'wss')).toBeNull()
  })

  it('returns null when no SSH target is stored', () => {
    expect(
      selectSshRepairProfile([
        { endpointId: 'wss', kind: 'direct-wss', label: 'd', target: 'wss://x' },
      ]),
    ).toBeNull()
  })

  it('uses the first SSH profile when no preferred id is set', () => {
    expect(selectSshRepairProfile([SSH_ENDPOINT])?.endpointId).toBe('ssh')
  })
})

describe('repair pairing over SSH', () => {
  it('mints a token on the host and re-pairs under the same connectionId', async () => {
    const d = deps()

    await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] },
      d,
    )

    // Tunnel is rebuilt from the stored endpoint — the old local port is gone.
    expect(d.ensureTunnel).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'user@host',
        remotePort: 7788,
        sshPort: 2222,
        identityFile: '/keys/id_ed25519',
      }),
    )
    expect(d.repairPairing).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      baseUrl: 'http://127.0.0.1:51234',
      pairingToken: 'tok-fresh',
    })
  })

  it('runs pair-create against the discovered superone binary and node home', async () => {
    const d = deps()

    await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] },
      d,
    )

    const call = (d.sshCapture as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.destination).toBe('user@host')
    expect(call.command).toContain('/home/u/.local/bin/superone')
    expect(call.command).toContain('/home/u/.superone/node')
    expect(call.command).toContain('pair-create')
    // Version-manager installs need their bin dir on PATH for the remote shell.
    expect(call.command).toContain('/home/u/.nvm/versions/node/v22/bin')
    expect(call.extraArgs).toEqual(['-p', '2222', '-i', '/keys/id_ed25519'])
  })

  it('uses stored remoteExec + remoteNodeHome + nodeBinDir without probing the host', async () => {
    const d = deps()
    const stored: EndpointProfile = {
      ...SSH_ENDPOINT,
      ssh: {
        ...SSH_ENDPOINT.ssh,
        remoteExec: '/opt/superone/bin/superone',
        remoteNodeHome: '/var/lib/superone-node',
        nodeBinDir: '/home/u/.nvm/versions/node/v22/bin',
      },
    }

    await repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [stored] }, d)

    expect(d.probeHost).not.toHaveBeenCalled()
    const call = (d.sshCapture as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.command).toContain('/opt/superone/bin/superone')
    expect(call.command).toContain('/var/lib/superone-node')
    // Shebang launchers need the version-manager Node bin on PATH.
    expect(call.command).toContain('/home/u/.nvm/versions/node/v22/bin')
    expect(call.command).not.toContain('/home/u/.superone/node')
  })

  it('still probes for nodeBinDir when only exec/home were persisted', async () => {
    const d = deps()
    const partial: EndpointProfile = {
      ...SSH_ENDPOINT,
      ssh: {
        ...SSH_ENDPOINT.ssh,
        remoteExec: '/opt/superone/bin/superone',
        remoteNodeHome: '/var/lib/superone-node',
        // nodeBinDir intentionally missing (pre-fix legacy + incomplete store)
      },
    }

    await repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [partial] }, d)

    expect(d.probeHost).toHaveBeenCalled()
    const call = (d.sshCapture as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.command).toContain('/opt/superone/bin/superone')
    expect(call.command).toContain('/var/lib/superone-node')
    expect(call.command).toContain('/home/u/.nvm/versions/node/v22/bin')
  })

  it('skips probe when nodeBinDir is explicitly empty (system Node)', async () => {
    const d = deps()
    const stored: EndpointProfile = {
      ...SSH_ENDPOINT,
      ssh: {
        ...SSH_ENDPOINT.ssh,
        remoteExec: '/usr/local/bin/superone',
        remoteNodeHome: '/home/u/.superone/node',
        nodeBinDir: '',
      },
    }

    await repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [stored] }, d)

    expect(d.probeHost).not.toHaveBeenCalled()
    const call = (d.sshCapture as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.command).toContain('/usr/local/bin/superone')
    // No PATH= prefix when nodeBinDir is empty.
    expect(call.command).not.toMatch(/export PATH=/)
  })

  it('selects the preferred SSH endpoint when multiple are present', async () => {
    const d = deps()
    const a: EndpointProfile = {
      endpointId: 'ssh-a',
      kind: 'ssh-forward',
      label: 'A',
      target: 'user@a',
      ssh: { remotePort: 7788 },
    }
    const b: EndpointProfile = {
      endpointId: 'ssh-b',
      kind: 'ssh-forward',
      label: 'B',
      target: 'user@b',
      ssh: { remotePort: 7799 },
    }

    await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [a, b], preferredEndpointId: 'ssh-b' },
      d,
    )

    expect(d.ensureTunnel).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'user@b', remotePort: 7799 }),
    )
  })

  it('refuses a connection that has no SSH endpoint instead of half-repairing', async () => {
    const d = deps()
    const direct: EndpointProfile = {
      endpointId: 'wss',
      kind: 'direct-wss',
      label: 'direct',
      target: 'wss://node.example:7788',
    }

    await expect(
      repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [direct] }, d),
    ).rejects.toMatchObject({ code: 'failed_precondition' })
    expect(d.repairPairing).not.toHaveBeenCalled()
  })

  it('reports a missing remote CLI rather than failing later on an empty token', async () => {
    const d = deps({
      probeHost: vi.fn().mockResolvedValue({ ...PROBE, superonePath: null }),
    })

    await expect(
      repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] }, d),
    ).rejects.toMatchObject({ code: 'failed_precondition' })
    expect(d.sshCapture).not.toHaveBeenCalled()
  })

  it('surfaces pair-create failure without echoing the remote stdout', async () => {
    const d = deps({
      sshCapture: vi.fn().mockResolvedValue({
        stdout: 'leaked-secret-looking-blob',
        stderr: 'pair-create: permission denied',
        code: 1,
      }),
    })

    const err = await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] },
      d,
    ).catch((e: Error) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('permission denied')
    expect((err as Error).message).not.toContain('leaked-secret-looking-blob')
    expect(d.repairPairing).not.toHaveBeenCalled()
  })

  it('fails clearly when pair-create returns no token JSON', async () => {
    const d = deps({
      sshCapture: vi.fn().mockResolvedValue({ stdout: 'no json here', stderr: '', code: 0 }),
    })

    await expect(
      repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] }, d),
    ).rejects.toThrow(/pair-create/i)
    expect(d.repairPairing).not.toHaveBeenCalled()
  })

  it('propagates an identity mismatch from the re-pair so the trust check is not swallowed', async () => {
    const d = deps({
      repairPairing: vi.fn().mockRejectedValue(
        Object.assign(new Error('environment identity mismatch'), { code: 'identity_conflict' }),
      ),
    })

    await expect(
      repairPairingOverSsh({ connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] }, d),
    ).rejects.toMatchObject({ code: 'identity_conflict' })
  })

  it('reports progress phases so the UI can show more than a spinner', async () => {
    const phases: string[] = []
    await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [SSH_ENDPOINT] },
      deps(),
      (p) => phases.push(p.phase),
    )

    expect(phases).toEqual(['probing', 'starting', 'pairing'])
  })

  it('skips the probing phase when stored admin metadata is complete', async () => {
    const phases: string[] = []
    const stored: EndpointProfile = {
      ...SSH_ENDPOINT,
      ssh: {
        ...SSH_ENDPOINT.ssh,
        remoteExec: '/opt/superone/bin/superone',
        remoteNodeHome: '/var/lib/superone-node',
        nodeBinDir: '/home/u/.nvm/versions/node/v22/bin',
      },
    }

    await repairPairingOverSsh(
      { connectionId: 'conn-1', endpointProfiles: [stored] },
      deps(),
      (p) => phases.push(p.phase),
    )

    expect(phases).toEqual(['starting', 'pairing'])
  })
})
