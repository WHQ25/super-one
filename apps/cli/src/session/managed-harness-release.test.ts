import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MANAGED_PAYLOAD_BASENAME,
  assertSafePathSegment,
  currentCliVersion,
  currentHostArch,
  currentHostPlatform,
  describeExpectedArtifact,
  installManagedArtifactFromFile,
  loadHarnessReleaseManifest,
  parseHarnessReleaseManifest,
  sha256File,
} from './managed-harness-release'

const dirs: string[] = []
const prevManifest = process.env.SUPERONE_HARNESS_MANIFEST
const prevCli = process.env.SUPERONE_CLI_VERSION

afterEach(() => {
  if (prevManifest === undefined) delete process.env.SUPERONE_HARNESS_MANIFEST
  else process.env.SUPERONE_HARNESS_MANIFEST = prevManifest
  if (prevCli === undefined) delete process.env.SUPERONE_CLI_VERSION
  else process.env.SUPERONE_CLI_VERSION = prevCli
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function sha(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

function makeNodeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'mhr-'))
  dirs.push(dir)
  return dir
}

function hostManifest(cliVersion: string, digest: string, harnessId: 'claude' | 'codex' = 'codex') {
  return {
    cliVersion,
    managedHarnesses: {
      [harnessId]: {
        runtimeVersion: '0.145.0',
        artifactVersion: 'superone-codex-0.145.0.2',
        artifacts: [
          {
            platform: currentHostPlatform(),
            arch: currentHostArch(),
            digestSha256: digest,
            fileName: 'would-be-ignored.bin',
          },
        ],
      },
    },
  }
}

describe('managed harness release (Stage 3)', () => {
  it('rejects path-escaping version segments', () => {
    expect(() => assertSafePathSegment('../../tmp/owned', 'cliVersion')).toThrow()
    expect(() => assertSafePathSegment('a/b', 'artifactVersion')).toThrow()
    expect(() => assertSafePathSegment('..', 'cliVersion')).toThrow()
    expect(() =>
      parseHarnessReleaseManifest({
        cliVersion: '../../../../tmp/owned',
        managedHarnesses: {
          codex: {
            runtimeVersion: '1',
            artifactVersion: '../../../../../victim',
            artifacts: [
              {
                platform: 'darwin',
                arch: 'arm64',
                digestSha256: 'a'.repeat(64),
              },
            ],
          },
        },
      }),
    ).toThrow(/cliVersion|path segment|invalid/)
  })

  it('rejects duplicate platform/arch pins and bad digests', () => {
    expect(() =>
      parseHarnessReleaseManifest({
        cliVersion: '0.49.4',
        managedHarnesses: {
          codex: {
            runtimeVersion: '0.1.0',
            artifactVersion: 'a.1',
            artifacts: [
              { platform: 'linux', arch: 'x64', digestSha256: 'a'.repeat(64) },
              { platform: 'linux', arch: 'x64', digestSha256: 'b'.repeat(64) },
            ],
          },
        },
      }),
    ).toThrow(/duplicate/)

    expect(() =>
      parseHarnessReleaseManifest({
        cliVersion: '1',
        managedHarnesses: {
          codex: {
            runtimeVersion: '1',
            artifactVersion: '1',
            artifacts: [{ platform: 'linux', arch: 'x64', digestSha256: 'nope' }],
          },
        },
      }),
    ).toThrow(/digestSha256/)
  })

  it('installs offline artifact only when digest matches; uses fixed payload name', async () => {
    process.env.SUPERONE_CLI_VERSION = '0.49.4-test'
    const nodeHome = makeNodeHome()
    const payload = Buffer.from('codex-runtime-bytes-v1')
    const digest = sha(payload)
    const platform = currentHostPlatform()
    const arch = currentHostArch()

    writeFileSync(
      join(nodeHome, 'release-manifest.json'),
      JSON.stringify(hostManifest('0.49.4-test', digest)),
    )

    const good = join(nodeHome, 'good.bin')
    writeFileSync(good, payload)
    const bad = join(nodeHome, 'bad.bin')
    writeFileSync(bad, 'wrong-bytes')

    const manifest = loadHarnessReleaseManifest(nodeHome)!
    expect(manifest.cliVersion).toBe('0.49.4-test')
    expect(currentCliVersion()).toBe('0.49.4-test')

    await expect(
      installManagedArtifactFromFile({
        nodeHome,
        harnessId: 'codex',
        artifactPath: bad,
        manifest,
      }),
    ).rejects.toThrow(/digest mismatch/)

    const installed = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: 'codex',
      artifactPath: good,
      manifest,
    })
    expect(installed.installPath.endsWith(MANAGED_PAYLOAD_BASENAME)).toBe(true)
    expect(installed.installPath).toContain('/releases/0.49.4-test/harnesses/codex/')
    expect(installed.reusedExisting).toBe(false)
    expect(await sha256File(installed.installPath)).toBe(digest)
    expect(readFileSync(installed.installPath)).toEqual(payload)

    // Reinstall reuses immutable version dir without deletion.
    const again = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: 'codex',
      artifactPath: good,
      manifest,
    })
    expect(again.installPath).toBe(installed.installPath)
    expect(again.reusedExisting).toBe(true)
    expect(existsSync(installed.installPath)).toBe(true)
  })

  it('refuses install when manifest cliVersion does not match running CLI', async () => {
    process.env.SUPERONE_CLI_VERSION = '0.49.4-test'
    const nodeHome = makeNodeHome()
    const payload = Buffer.from('x')
    const digest = sha(payload)
    writeFileSync(
      join(nodeHome, 'release-manifest.json'),
      JSON.stringify(hostManifest('9.9.9', digest)),
    )
    const good = join(nodeHome, 'g.bin')
    writeFileSync(good, payload)
    const manifest = loadHarnessReleaseManifest(nodeHome)!
    await expect(
      installManagedArtifactFromFile({
        nodeHome,
        harnessId: 'codex',
        artifactPath: good,
        manifest,
      }),
    ).rejects.toThrow(/does not match CLI/)
  })

  it('fileName in manifest never becomes the payload path (metadata collision)', async () => {
    process.env.SUPERONE_CLI_VERSION = '0.1.0'
    const nodeHome = makeNodeHome()
    const payload = Buffer.from('payload-bytes')
    const digest = sha(payload)
    const manifest = parseHarnessReleaseManifest({
      cliVersion: '0.1.0',
      managedHarnesses: {
        codex: {
          runtimeVersion: '1.0.0',
          artifactVersion: 'art-1',
          artifacts: [
            {
              platform: currentHostPlatform(),
              arch: currentHostArch(),
              digestSha256: digest,
              // Would overwrite metadata if trusted as path.
              fileName: 'artifact.json',
            },
          ],
        },
      },
    })
    const good = join(nodeHome, 'in.bin')
    writeFileSync(good, payload)
    const installed = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: 'codex',
      artifactPath: good,
      manifest,
    })
    expect(installed.installPath.endsWith(MANAGED_PAYLOAD_BASENAME)).toBe(true)
    expect(await sha256File(installed.installPath)).toBe(digest)
    // Metadata file coexists and is not the payload.
    const meta = join(installed.installPath, '..', 'artifact.json')
    expect(existsSync(meta)).toBe(true)
    expect(await sha256File(meta)).not.toBe(digest)
  })

  it('repair replaces a corrupted payload; enable refuses to overwrite', async () => {
    process.env.SUPERONE_CLI_VERSION = '0.2.0'
    const nodeHome = makeNodeHome()
    const payload = Buffer.from('good-payload')
    const digest = sha(payload)
    const manifest = parseHarnessReleaseManifest(hostManifest('0.2.0', digest))
    const good = join(nodeHome, 'good.bin')
    writeFileSync(good, payload)

    const installed = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: 'codex',
      artifactPath: good,
      manifest,
      mode: 'enable',
    })
    // Corrupt the installed payload.
    writeFileSync(installed.installPath, 'CORRUPT')
    expect(await sha256File(installed.installPath)).not.toBe(digest)

    await expect(
      installManagedArtifactFromFile({
        nodeHome,
        harnessId: 'codex',
        artifactPath: good,
        manifest,
        mode: 'enable',
      }),
    ).rejects.toThrow(/refusing to overwrite|digest mismatch/)

    const repaired = await installManagedArtifactFromFile({
      nodeHome,
      harnessId: 'codex',
      artifactPath: good,
      manifest,
      mode: 'repair',
    })
    expect(repaired.installPath).toBe(installed.installPath)
    expect(await sha256File(repaired.installPath)).toBe(digest)
    expect(readFileSync(repaired.installPath)).toEqual(payload)
  })

  it('describeExpectedArtifact mentions digest when pin exists for host', () => {
    const platform = currentHostPlatform()
    const arch = currentHostArch()
    const manifest = parseHarnessReleaseManifest({
      cliVersion: '1.0.0',
      managedHarnesses: {
        claude: {
          runtimeVersion: '0.3.220',
          artifactVersion: 'superone-claude-0.3.220.1',
          artifacts: [
            {
              platform,
              arch,
              digestSha256: 'b'.repeat(64),
            },
          ],
        },
      },
    })
    const msg = describeExpectedArtifact('claude', manifest)
    expect(msg).toContain('b'.repeat(64))
    expect(msg).toMatch(/offline --artifact/)
  })
})
