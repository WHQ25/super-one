import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runHarnessCli } from './harness-cli'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import { currentHostArch, currentHostPlatform } from './managed-harness-release'

const dirs: string[] = []
const prevHome = process.env.SUPERONE_NODE_HOME
const prevHarnessHome = process.env.SUPERONE_HARNESS_HOME
const prevCli = process.env.SUPERONE_CLI_VERSION

afterEach(() => {
  if (prevHome === undefined) delete process.env.SUPERONE_NODE_HOME
  else process.env.SUPERONE_NODE_HOME = prevHome
  if (prevHarnessHome === undefined) delete process.env.SUPERONE_HARNESS_HOME
  else process.env.SUPERONE_HARNESS_HOME = prevHarnessHome
  if (prevCli === undefined) delete process.env.SUPERONE_CLI_VERSION
  else process.env.SUPERONE_CLI_VERSION = prevCli
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Isolate catalog (node) + managed binary root (harness) for CLI tests. */
function withNodeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'hcli-'))
  dirs.push(dir)
  process.env.SUPERONE_NODE_HOME = dir
  // Managed install + release-manifest live under harness home, not node home.
  const harnessHome = join(dir, 'harness')
  mkdirSync(harnessHome, { recursive: true })
  process.env.SUPERONE_HARNESS_HOME = harnessHome
  return dir
}

function harnessHomeOf(nodeHome: string): string {
  return join(nodeHome, 'harness')
}

function writeManagedManifest(nodeHome: string, harnessId: 'claude' | 'codex', digest: string) {
  process.env.SUPERONE_CLI_VERSION = '0.49.4-test'
  const harnessHome = harnessHomeOf(nodeHome)
  mkdirSync(harnessHome, { recursive: true })
  writeFileSync(
    join(harnessHome, 'release-manifest.json'),
    JSON.stringify({
      cliVersion: '0.49.4-test',
      managedHarnesses: {
        [harnessId]: {
          runtimeVersion: harnessId === 'codex' ? '0.145.0' : '0.3.220',
          artifactVersion: `superone-${harnessId}-test.1`,
          artifacts: [
            {
              platform: currentHostPlatform(),
              arch: currentHostArch(),
              digestSha256: digest,
              fileName: `${harnessId}.bin`,
            },
          ],
        },
      },
    }),
  )
}

function makeExec(dir: string, name: string): string {
  const bin = join(dir, name)
  writeFileSync(bin, '#!/bin/sh\nexit 0\n')
  chmodSync(bin, 0o755)
  return realpathSync(bin)
}

function abs(path: string): string {
  return realpathSync(path)
}

describe('harness CLI (Stage 2)', () => {
  it('lists all first-party harnesses as disabled by default (json)', async () => {
    withNodeHome()
    const result = await runHarnessCli(['list', '--json'])
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    const list = result.json as HarnessInstallationStatus[]
    expect(list).toHaveLength(5)
    expect(list.every((h) => !h.enabled && h.state === 'disabled')).toBe(true)
  })

  it('list --help shows help instead of running list', async () => {
    withNodeHome()
    const result = await runHarnessCli(['list', '--help'])
    expect(result.ok).toBe(true)
    expect(result.text).toMatch(/Usage: superone harness list/)
  })

  it('rejects unknown and deferred options', async () => {
    withNodeHome()
    const unknown = await runHarnessCli(['list', '--wat'])
    expect(unknown.ok).toBe(false)
    expect(unknown.text).toMatch(/unknown option/)

    const deferred = await runHarnessCli(['enable', 'opencode', '--env-file', '/tmp/x', '--json'])
    expect(deferred.ok).toBe(false)
    expect(JSON.stringify(deferred.json)).toMatch(/not implemented|deferred/i)
  })

  it('enables managed harness with verified offline --artifact into needs_auth', async () => {
    const home = withNodeHome()
    const bytes = Buffer.from('fake-codex-runtime')
    const digest = createHash('sha256').update(bytes).digest('hex')
    writeManagedManifest(home, 'codex', digest)
    const artifact = join(home, 'codex-artifact.bin')
    writeFileSync(artifact, bytes)
    chmodSync(artifact, 0o644)

    const enabled = await runHarnessCli(['enable', 'codex', '--artifact', artifact, '--json'])
    expect(enabled.ok).toBe(true)
    const status = enabled.json as HarnessInstallationStatus
    expect(status.id).toBe('codex')
    expect(status.enabled).toBe(true)
    expect(status.state).toBe('needs_auth')
    expect(status.runtimeVersion).toBe('0.145.0')
    // Installed under releases/, not the original upload path.
    expect(status.command).toContain('/releases/0.49.4-test/harnesses/codex/')
    expect(status.command).not.toBe(abs(artifact))

    const show = await runHarnessCli(['show', 'codex', '--json'])
    const detail = show.json as {
      state: string
      lastProbedAt: number | null
      installationPath: string | null
      requiredRuntimeVersion: string | null
      configSummary: { artifactPath?: string; digestSha256?: string; source?: string }
    }
    expect(detail.state).toBe('needs_auth')
    expect(detail.requiredRuntimeVersion).toBe('0.145.0')
    expect(detail.installationPath).toBe(status.command)
    expect(detail.configSummary?.source).toBe('offline-artifact')
    expect(detail.configSummary?.digestSha256).toBe(digest)
  })

  it('repair restores a corrupted managed payload', async () => {
    const home = withNodeHome()
    const bytes = Buffer.from('repair-me')
    const digest = createHash('sha256').update(bytes).digest('hex')
    writeManagedManifest(home, 'codex', digest)
    const artifact = join(home, 'codex.bin')
    writeFileSync(artifact, bytes)

    const enabled = await runHarnessCli(['enable', 'codex', '--artifact', artifact, '--json'])
    expect(enabled.ok).toBe(true)
    const path = (enabled.json as HarnessInstallationStatus).command!
    writeFileSync(path, 'broken')

    const enableAgain = await runHarnessCli(['enable', 'codex', '--artifact', artifact, '--json'])
    expect(enableAgain.ok).toBe(false)

    const repaired = await runHarnessCli(['repair', 'codex', '--artifact', artifact, '--json'])
    expect(repaired.ok).toBe(true)
    const status = repaired.json as HarnessInstallationStatus
    expect(status.command).toBe(path)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(digest)
  })

  it('auto-enables claude from Agent SDK when present; offline artifact still verifies digest', async () => {
    const home = withNodeHome()
    // Without --artifact: use Agent SDK platform binary when monorepo/deps provide it.
    const auto = await runHarnessCli(['enable', 'claude', '--json'])
    if (auto.ok) {
      const status = auto.json as HarnessInstallationStatus
      expect(status.enabled).toBe(true)
      expect(['needs_auth', 'ready']).toContain(status.state)
      expect(status.command).toBeTruthy()
    } else {
      // CI without optional SDK packages: fail closed with a clear message.
      expect(JSON.stringify(auto.json)).toMatch(/claude runtime not found|manifest|Agent SDK/i)
    }

    writeManagedManifest(home, 'claude', 'c'.repeat(64))
    const wrong = join(home, 'wrong.bin')
    writeFileSync(wrong, 'nope')
    const badDigest = await runHarnessCli(['enable', 'claude', '--artifact', wrong, '--json'])
    expect(badDigest.ok).toBe(false)
    expect(JSON.stringify(badDigest.json)).toMatch(/digest mismatch/i)

    const rel = await runHarnessCli(['enable', 'claude', '--artifact', 'relative.bin', '--json'])
    expect(rel.ok).toBe(false)
  })

  it('enables acp-grok when command is a regular executable and disables cleanly', async () => {
    const home = withNodeHome()
    const bin = makeExec(home, 'fake-grok')

    const enabled = await runHarnessCli([
      'enable',
      'acp-grok',
      '--command',
      bin,
      '--arg',
      'agent',
      '--arg',
      'stdio',
      '--json',
    ])
    expect(enabled.ok).toBe(true)
    const status = enabled.json as HarnessInstallationStatus
    expect(status.state).toBe('ready')
    expect(status.command).toBe(bin)

    const doctor = await runHarnessCli(['doctor', 'acp-grok', '--json'])
    expect(doctor.ok).toBe(true)

    const disabled = await runHarnessCli(['disable', 'acp-grok', '--json'])
    expect((disabled.json as HarnessInstallationStatus).state).toBe('disabled')
  })

  it('does not mark directories or non-executables as ready', async () => {
    const home = withNodeHome()
    const dir = join(home, 'not-a-bin')
    mkdirSync(dir)
    const asDir = await runHarnessCli(['enable', 'opencode', '--command', dir, '--json'])
    expect(asDir.ok).toBe(true)
    expect((asDir.json as HarnessInstallationStatus).state).toBe('missing')

    const file = join(home, 'noexec')
    writeFileSync(file, 'x')
    chmodSync(file, 0o644)
    const asFile = await runHarnessCli(['enable', 'opencode', '--command', file, '--json'])
    expect((asFile.json as HarnessInstallationStatus).state).toBe('missing')
  })

  it('configure is transactional: failed probe keeps previous working state', async () => {
    const home = withNodeHome()
    const good = makeExec(home, 'opencode-good')
    await runHarnessCli(['enable', 'opencode', '--command', good, '--json'])

    const bad = await runHarnessCli([
      'configure',
      'opencode',
      '--command',
      join(home, 'missing-bin'),
      '--json',
    ])
    expect(bad.ok).toBe(false)

    const show = await runHarnessCli(['show', 'opencode', '--json'])
    const detail = show.json as {
      state: string
      command?: string
      configSummary: { command?: string }
    }
    expect(detail.state).toBe('ready')
    expect(detail.command).toBe(good)
    expect(detail.configSummary?.command).toBe(good)
  })

  it('rejects credential-bearing server URLs and secret-like args; show never leaks them', async () => {
    withNodeHome()
    const url = await runHarnessCli([
      'enable',
      'opencode',
      '--server-url',
      'http://user:secret@localhost:4096/?token=abc123',
      '--json',
    ])
    expect(url.ok).toBe(false)
    expect(JSON.stringify(url.json)).not.toContain('secret')

    const home = withNodeHome()
    const bin = makeExec(home, 'grok')
    const args = await runHarnessCli([
      'enable',
      'acp-grok',
      '--command',
      bin,
      '--arg',
      'API_KEY=reviewsecret',
      '--json',
    ])
    expect(args.ok).toBe(false)
    expect(JSON.stringify(args.json)).not.toContain('reviewsecret')

    // Even if a contaminated row existed, public summary must not dump raw args.
    await runHarnessCli(['enable', 'acp-grok', '--command', bin, '--arg', 'agent', '--json'])
    const show = await runHarnessCli(['show', 'acp-grok', '--json'])
    const text = JSON.stringify(show.json)
    expect(text).not.toMatch(/password|Bearer |secret_ref/i)
    expect(text).toContain('"argCount"')
    expect(text).not.toContain('"args"')
  })

  it('repair is managed-only; configure rejects claude', async () => {
    withNodeHome()
    expect((await runHarnessCli(['repair', 'opencode', '--json'])).ok).toBe(false)
    expect((await runHarnessCli(['configure', 'claude', '--json'])).ok).toBe(false)
  })

  it('rejects flags that are not valid for the target harness', async () => {
    withNodeHome()
    const withArtifact = await runHarnessCli([
      'enable',
      'opencode',
      '--artifact',
      '/ignored',
      '--server-url',
      'https://example.com',
      '--json',
    ])
    expect(withArtifact.ok).toBe(false)
    expect(JSON.stringify(withArtifact.json)).toMatch(/unknown option|--artifact/)

    const withDefault = await runHarnessCli([
      'configure',
      'opencode',
      '--default-args',
      '--server-url',
      'https://example.com',
      '--json',
    ])
    expect(withDefault.ok).toBe(false)
  })

  it('accepts dash-leading --arg values and --arg= form', async () => {
    const home = withNodeHome()
    const bin = makeExec(home, 'grok-dash')
    const spaced = await runHarnessCli([
      'enable',
      'acp-grok',
      '--command',
      bin,
      '--arg',
      '--profile',
      '--json',
    ])
    expect(spaced.ok).toBe(true)
    expect((spaced.json as HarnessInstallationStatus).state).toBe('ready')

    await runHarnessCli(['disable', 'acp-grok', '--json'])
    const eq = await runHarnessCli([
      'enable',
      'acp-grok',
      '--command',
      bin,
      '--arg=--profile',
      '--json',
    ])
    expect(eq.ok).toBe(true)
  })

  it('list/show parse errors honor --json', async () => {
    withNodeHome()
    const list = await runHarnessCli(['list', '--json', '--wat'])
    expect(list.ok).toBe(false)
    expect(list.json).toMatchObject({ ok: false })
    expect(list.text).toBe('')

    const show = await runHarnessCli(['show', '--json'])
    expect(show.ok).toBe(false)
    expect(show.json).toMatchObject({ ok: false })
  })

  it('public show never emits serverUrl path tokens', async () => {
    withNodeHome()
    // Path may contain token-like segments; public summary must be origin only.
    const enabled = await runHarnessCli([
      'enable',
      'opencode',
      '--server-url',
      'https://example.com/api/sk-reviewsecret123',
      '--json',
    ])
    expect(enabled.ok).toBe(true)
    const show = await runHarnessCli(['show', 'opencode', '--json'])
    const text = JSON.stringify(show.json)
    expect(text).not.toContain('sk-reviewsecret123')
    expect(text).not.toContain('/api/')
    const detail = show.json as { configSummary: { serverUrl?: string } }
    expect(detail.configSummary?.serverUrl).toBe('https://example.com')
  })
})
