import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_CLI_MIN_VERSIONS,
  checkExternalCliVersion,
  compareExternalCliVersions,
  extractCliFailureReason,
  extractLatestCliProgressLine,
  formatExternalCliUpgradeMessage,
  getExternalCliInstallSpec,
  getExternalCliMinVersion,
  normalizeExternalCliVersion,
} from './external-cli-install'

describe('external CLI minimum version management', () => {
  it('defines minimum versions for all external CLIs', () => {
    expect(EXTERNAL_CLI_MIN_VERSIONS).toEqual({
      opencode: '2.0.0',
      'acp-grok': '1.0.92',
      'acp-antigravity': '1.5.16',
    })
    expect(getExternalCliMinVersion('acp-antigravity')).toBe('1.5.16')
    expect(getExternalCliMinVersion('acp-grok')).toBe('1.0.92')
    expect(getExternalCliMinVersion('opencode')).toBe('2.0.0')
    expect(getExternalCliInstallSpec('acp-antigravity', 'darwin').minVersion).toBe('1.5.16')
  })

  it('normalizes version strings from CLI outputs', () => {
    expect(normalizeExternalCliVersion('1.5.18')).toBe('1.5.18')
    expect(normalizeExternalCliVersion('v1.5.16')).toBe('1.5.16')
    expect(normalizeExternalCliVersion('agy 1.5.16-beta.1\n')).toBe('1.5.16-beta.1')
    expect(normalizeExternalCliVersion('grok version 1.0.92 (build 123)')).toBe('1.0.92')
    expect(normalizeExternalCliVersion('opencode 2.0.0')).toBe('2.0.0')
    expect(normalizeExternalCliVersion('')).toBeUndefined()
    expect(normalizeExternalCliVersion('unknown')).toBeUndefined()
    expect(normalizeExternalCliVersion(undefined)).toBeUndefined()
  })

  it('compares semantic version tuples', () => {
    expect(compareExternalCliVersions('1.5.15', '1.5.16')).toBeLessThan(0)
    expect(compareExternalCliVersions('1.5.16', '1.5.16')).toBe(0)
    expect(compareExternalCliVersions('1.5.18', '1.5.16')).toBeGreaterThan(0)
    expect(compareExternalCliVersions('1.6.0', '1.5.99')).toBeGreaterThan(0)
    expect(compareExternalCliVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareExternalCliVersions('1.5.16-g1234', '1.5.16')).toBe(0)
    expect(compareExternalCliVersions('1.5.15-rc.1', '1.5.16')).toBeLessThan(0)
    expect(compareExternalCliVersions('invalid', '1.5.16')).toBeNull()
  })

  it('checks compatibility against the harness minimum version', () => {
    expect(checkExternalCliVersion('acp-antigravity', '1.5.15')).toEqual({
      ok: false,
      actualVersion: '1.5.15',
      minVersion: '1.5.16',
    })
    expect(checkExternalCliVersion('acp-antigravity', '1.5.16')).toEqual({
      ok: true,
      actualVersion: '1.5.16',
      minVersion: '1.5.16',
    })
    expect(checkExternalCliVersion('acp-antigravity', 'agy 1.5.18')).toEqual({
      ok: true,
      actualVersion: '1.5.18',
      minVersion: '1.5.16',
    })
    expect(checkExternalCliVersion('acp-grok', '1.0.91')).toEqual({
      ok: false,
      actualVersion: '1.0.91',
      minVersion: '1.0.92',
    })
    expect(checkExternalCliVersion('acp-grok', '1.0.92')).toEqual({
      ok: true,
      actualVersion: '1.0.92',
      minVersion: '1.0.92',
    })
    expect(checkExternalCliVersion('opencode', '1.9.0')).toEqual({
      ok: false,
      actualVersion: '1.9.0',
      minVersion: '2.0.0',
    })
    expect(checkExternalCliVersion('opencode', '2.0.0')).toEqual({
      ok: true,
      actualVersion: '2.0.0',
      minVersion: '2.0.0',
    })
    expect(checkExternalCliVersion('acp-antigravity', undefined)).toEqual({
      ok: true,
      minVersion: '1.5.16',
    })
    expect(checkExternalCliVersion('acp-antigravity', 'not-a-version')).toEqual({
      ok: true,
      minVersion: '1.5.16',
    })
  })

  it('formats actionable upgrade messages per platform', () => {
    const macMsg = formatExternalCliUpgradeMessage('acp-antigravity', '1.5.3', '1.5.16', 'darwin')
    expect(macMsg).toContain('agy CLI 1.5.3')
    expect(macMsg).toContain('1.5.16')
    expect(macMsg).toContain('agy update')

    const winMsg = formatExternalCliUpgradeMessage('acp-grok', '1.0.80', '1.0.92', 'win32')
    expect(winMsg).toContain('grok CLI 1.0.80')
    expect(winMsg).toContain('1.0.92')
    expect(winMsg).toContain('grok update')
  })

  it('extracts ANSI-free single-line progress and failure reasons', () => {
    expect(
      extractLatestCliProgressLine('\x1b[32mChecking latest version...\x1b[0m\r\x1b[36mDownloading agy 1.5.18 (42%)\x1b[0m'),
    ).toBe('Downloading agy 1.5.18 (42%)')
    expect(extractLatestCliProgressLine('\n  \r\n')).toBeNull()

    expect(
      extractCliFailureReason(
        'Checking updates...\nError: network timeout while fetching manifest\nTry again later.\n',
      ),
    ).toBe('Error: network timeout while fetching manifest')
    expect(extractCliFailureReason('line 1\nlast line\n')).toBe('last line')
  })
})
