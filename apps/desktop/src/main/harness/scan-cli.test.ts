import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultOnboardingSelection, scanHarnessCli, type HarnessCliScanHit } from './scan-cli'

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
})
