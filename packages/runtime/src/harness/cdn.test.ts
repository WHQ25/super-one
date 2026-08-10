import { describe, expect, it } from 'vitest'
import {
  HARNESS_CDN_BASE,
  fetchHarnessChannelManifest,
  harnessArtifactObjectKey,
  harnessArtifactPublicUrl,
  harnessChannelManifestObjectKey,
  harnessChannelManifestUrl,
  isHarnessManifestChannel,
  npmNameToArtifactDir,
  selectHarnessArtifact,
} from './cdn'
import { parseHarnessReleaseManifest } from './managed-release'

describe('npmNameToArtifactDir', () => {
  it('strips scope and flattens slash', () => {
    expect(npmNameToArtifactDir('@anthropic-ai/claude-agent-sdk-darwin-arm64')).toBe(
      'anthropic-ai--claude-agent-sdk-darwin-arm64',
    )
    expect(npmNameToArtifactDir('@openai/codex')).toBe('openai--codex')
  })
})

describe('harness artifact keys', () => {
  it('builds object key and public URL', () => {
    expect(harnessArtifactObjectKey('@openai/codex', '0.146.1-darwin-arm64')).toBe(
      'harness/artifacts/openai--codex/0.146.1-darwin-arm64.tgz',
    )
    expect(harnessArtifactPublicUrl('@openai/codex', '0.146.1-darwin-arm64')).toBe(
      `${HARNESS_CDN_BASE}/harness/artifacts/openai--codex/0.146.1-darwin-arm64.tgz`,
    )
  })

  it('builds channel manifest paths', () => {
    expect(harnessChannelManifestObjectKey('alpha')).toBe('harness/manifest/alpha.json')
    expect(harnessChannelManifestUrl('stable')).toBe(`${HARNESS_CDN_BASE}/harness/manifest/stable.json`)
  })
})

describe('isHarnessManifestChannel', () => {
  it('accepts known channels only', () => {
    expect(isHarnessManifestChannel('alpha')).toBe(true)
    expect(isHarnessManifestChannel('latest')).toBe(false)
  })
})

describe('parseHarnessReleaseManifest with CDN fields', () => {
  it('accepts url / npmName / npmVersion on artifacts', () => {
    const digest = 'a'.repeat(64)
    const m = parseHarnessReleaseManifest({
      cliVersion: '0.52.0-alpha',
      managedHarnesses: {
        claude: {
          runtimeVersion: '0.3.226',
          artifactVersion: '0.3.226',
          artifacts: [
            {
              platform: 'darwin',
              arch: 'arm64',
              digestSha256: digest,
              fileName: 'pkg.tgz',
              url: 'https://dl.super-one.dev/harness/artifacts/x/0.3.226.tgz',
              npmName: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
              npmVersion: '0.3.226',
            },
          ],
        },
      },
    })
    const art = m.managedHarnesses.claude!.artifacts[0]!
    expect(art.url).toMatch(/^https:\/\//)
    expect(art.npmName).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64')
    expect(art.npmVersion).toBe('0.3.226')
  })

  it('rejects non-https url', () => {
    expect(() =>
      parseHarnessReleaseManifest({
        cliVersion: '0.1.0',
        managedHarnesses: {
          codex: {
            runtimeVersion: '0.1.0',
            artifactVersion: '0.1.0',
            artifacts: [
              {
                platform: 'darwin',
                arch: 'arm64',
                digestSha256: 'b'.repeat(64),
                url: 'http://insecure.example/x.tgz',
              },
            ],
          },
        },
      }),
    ).toThrow(/https/)
  })
})

describe('fetchHarnessChannelManifest + selectHarnessArtifact', () => {
  it('parses fetched JSON and selects platform pin', async () => {
    const digest = 'c'.repeat(64)
    const manifest = await fetchHarnessChannelManifest({
      channel: 'alpha',
      fetchJson: async () => ({
        cliVersion: '0.52.0-alpha',
        managedHarnesses: {
          claude: {
            runtimeVersion: '0.3.226',
            artifactVersion: '0.3.226',
            artifacts: [
              {
                platform: 'darwin',
                arch: 'arm64',
                digestSha256: digest,
                url: 'https://dl.super-one.dev/harness/artifacts/x/0.3.226.tgz',
              },
              {
                platform: 'linux',
                arch: 'x64',
                digestSha256: 'd'.repeat(64),
              },
            ],
          },
        },
      }),
    })
    const pin = selectHarnessArtifact(manifest, 'claude', 'darwin', 'arm64')
    expect(pin?.digestSha256).toBe(digest)
    expect(selectHarnessArtifact(manifest, 'claude', 'windows', 'x64')).toBeNull()
  })
})
