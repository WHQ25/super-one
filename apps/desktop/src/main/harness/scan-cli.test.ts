import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultOnboardingSelection,
  integrationLabels,
  normalizeCliVersion,
  scanHarnessCli,
  visibleOnboardingHarnesses,
  type HarnessCliScanHit,
} from './scan-cli'

describe('defaultOnboardingSelection', () => {
  it('pre-checks all detected harnesses', () => {
    const hits: HarnessCliScanHit[] = [
      { harnessId: 'claude', command: '/bin/claude', detected: true },
      { harnessId: 'codex', command: null, detected: false },
      { harnessId: 'opencode', command: '/bin/opencode', detected: true },
      { harnessId: 'acp-grok', command: null, detected: false },
    ]
    expect(defaultOnboardingSelection(hits)).toEqual(['claude', 'opencode'])
  })

  it('defaults to Claude only when nothing is detected', () => {
    const hits: HarnessCliScanHit[] = [
      { harnessId: 'claude', command: null, detected: false },
      { harnessId: 'codex', command: null, detected: false },
      { harnessId: 'opencode', command: null, detected: false },
      { harnessId: 'acp-grok', command: null, detected: false },
    ]
    expect(defaultOnboardingSelection(hits)).toEqual(['claude'])
  })
})

describe('visibleOnboardingHarnesses', () => {
  it('always lists Claude and Codex even when no CLI is on PATH', () => {
    const hits: HarnessCliScanHit[] = [
      { harnessId: 'claude', command: null, detected: false },
      { harnessId: 'codex', command: null, detected: false },
      { harnessId: 'opencode', command: null, detected: false },
      { harnessId: 'cursor', command: null, detected: false },
      { harnessId: 'acp-grok', command: null, detected: false },
    ]
    expect(visibleOnboardingHarnesses(hits)).toEqual(['claude', 'codex'])
  })

  it('does not list Cursor just because the SDK is bundled', () => {
    const hits: HarnessCliScanHit[] = [
      { harnessId: 'claude', command: null, detected: false },
      { harnessId: 'codex', command: null, detected: false },
      { harnessId: 'cursor', command: null, detected: false },
    ]
    expect(visibleOnboardingHarnesses(hits)).not.toContain('cursor')
  })

  it('appends experimental harnesses only when their CLI is detected', () => {
    const hits: HarnessCliScanHit[] = [
      { harnessId: 'claude', command: null, detected: false },
      { harnessId: 'codex', command: null, detected: false },
      { harnessId: 'opencode', command: '/bin/opencode', detected: true },
      { harnessId: 'cursor', command: '/bin/cursor', detected: true },
      { harnessId: 'acp-grok', command: null, detected: false },
    ]
    expect(visibleOnboardingHarnesses(hits)).toEqual([
      'claude',
      'codex',
      'opencode',
      'cursor',
    ])
  })
})

describe('normalizeCliVersion', () => {
  it('strips product names and git hashes', () => {
    expect(normalizeCliVersion('2.1.223 (Claude Code)')).toBe('2.1.223')
    expect(normalizeCliVersion('codex-cli 0.146.1')).toBe('0.146.1')
    expect(normalizeCliVersion('1.18.15')).toBe('1.18.15')
    expect(normalizeCliVersion('grok 1.0.0 (3cd0d0cbcebe)')).toBe('1.0.0')
  })
})

describe('integrationLabels', () => {
  it('labels each harness by integration surface (no versions)', () => {
    const labels = integrationLabels()
    expect(labels.claude.label).toBe('Claude Agent SDK')
    expect(labels.codex.label).toBe('Codex App Server')
    expect(labels.opencode.label).toBe('OpenCode SDK')
    expect(labels.cursor.label).toBe('Cursor Agent SDK')
    expect(labels['acp-grok'].label).toBe('Agent Client Protocol')
  })
})

describe('scanHarnessCli', () => {
  let dir: string
  let prevPath: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'so-scan-'))
    prevPath = process.env.PATH
    process.env.PATH = dir
  })

  afterEach(() => {
    process.env.PATH = prevPath
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects a binary on PATH', () => {
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\necho claude 1.0\n', { mode: 0o755 })
    chmodSync(bin, 0o755)
    // --version may fail on our stub script depending on shell; detection is enough.
    const hit = scanHarnessCli('claude')
    expect(hit.detected).toBe(true)
    expect(hit.command).toBeTruthy()
  })

  it('returns not detected when missing', () => {
    const hit = scanHarnessCli('opencode')
    expect(hit.detected).toBe(false)
    expect(hit.command).toBeNull()
  })

  it('detects Cursor via PATH CLI, not the bundled SDK', () => {
    expect(scanHarnessCli('cursor')).toMatchObject({ detected: false, command: null })

    const bin = join(dir, 'cursor')
    writeFileSync(bin, '#!/bin/sh\necho cursor 1.0\n', { mode: 0o755 })
    chmodSync(bin, 0o755)
    const hit = scanHarnessCli('cursor')
    expect(hit.detected).toBe(true)
    expect(hit.command).toBeTruthy()
  })
})
