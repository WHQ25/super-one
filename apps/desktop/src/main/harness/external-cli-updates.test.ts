import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import {
  checkExternalCliUpdates,
  clearExternalCliLatestVersionCache,
  fetchLatestExternalCliVersion,
  resolveExternalCliLatestVersionUrl,
} from './external-cli-updates'

afterEach(() => {
  clearExternalCliLatestVersionCache()
})

describe('external CLI update checker', () => {
  it('resolves latest version endpoints for each external CLI and platform', () => {
    expect(resolveExternalCliLatestVersionUrl('acp-antigravity', 'darwin', 'arm64')).toBe(
      'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json',
    )
    expect(resolveExternalCliLatestVersionUrl('acp-antigravity', 'win32', 'x64')).toBe(
      'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_amd64.json',
    )
    expect(resolveExternalCliLatestVersionUrl('acp-grok', 'darwin', 'arm64')).toBe(
      'https://registry.npmjs.org/%40xai-official%2Fgrok/latest',
    )
    expect(resolveExternalCliLatestVersionUrl('opencode', 'linux', 'x64')).toBe(
      'https://registry.npmjs.org/%40opencode%2Fcli/latest',
    )
  })

  it('caches latest versions by TTL and supports forced refresh', async () => {
    let nowMs = 1_000_000
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: '1.5.19' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: '1.5.20' }), { status: 200 }),
      )

    const v1 = await fetchLatestExternalCliVersion(
      'acp-antigravity',
      undefined,
      { fetchImpl, platform: 'darwin', arch: 'arm64', now: () => nowMs },
    )
    expect(v1).toBe('1.5.19')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    nowMs += 10_000
    const cached = await fetchLatestExternalCliVersion(
      'acp-antigravity',
      undefined,
      { fetchImpl, platform: 'darwin', arch: 'arm64', now: () => nowMs },
    )
    expect(cached).toBe('1.5.19')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const forced = await fetchLatestExternalCliVersion(
      'acp-antigravity',
      { force: true },
      { fetchImpl, platform: 'darwin', arch: 'arm64', now: () => nowMs },
    )
    expect(forced).toBe('1.5.20')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('compares installed versions against latest versions and minimum requirements', async () => {
    const installations: HarnessInstallationStatus[] = [
      {
        id: 'acp-antigravity',
        enabled: true,
        state: 'ready',
        runtimeSource: 'external',
        requiresAuth: false,
        runtimeVersion: '1.5.18',
      },
      {
        id: 'acp-grok',
        enabled: true,
        state: 'ready',
        runtimeSource: 'external',
        requiresAuth: true,
        runtimeVersion: '1.0.92',
      },
      {
        id: 'opencode',
        enabled: true,
        state: 'incompatible',
        runtimeSource: 'external',
        requiresAuth: false,
        runtimeVersion: '1.9.0',
      },
    ]

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('antigravity')) {
        return new Response(JSON.stringify({ version: '1.5.20' }), { status: 200 })
      }
      if (url.includes('grok')) {
        return new Response(JSON.stringify({ version: '1.0.92' }), { status: 200 })
      }
      return new Response(JSON.stringify({ version: '2.0.5' }), { status: 200 })
    })

    const result = await checkExternalCliUpdates(
      { force: true },
      {
        fetchImpl,
        platform: 'darwin',
        arch: 'arm64',
        now: () => 2_000_000,
        listInstallations: () => installations,
      },
    )

    expect(result['acp-antigravity']).toEqual({
      harnessId: 'acp-antigravity',
      currentVersion: '1.5.18',
      latestVersion: '1.5.20',
      updateAvailable: true,
      belowMinimum: false,
      minVersion: '1.5.16',
      checkedAt: 2_000_000,
    })
    expect(result['acp-grok']).toEqual({
      harnessId: 'acp-grok',
      currentVersion: '1.0.92',
      latestVersion: '1.0.92',
      updateAvailable: false,
      belowMinimum: false,
      minVersion: '1.0.92',
      checkedAt: 2_000_000,
    })
    expect(result.opencode).toEqual({
      harnessId: 'opencode',
      currentVersion: '1.9.0',
      latestVersion: '2.0.5',
      updateAvailable: true,
      belowMinimum: true,
      minVersion: '2.0.0',
      checkedAt: 2_000_000,
    })
  })
})
