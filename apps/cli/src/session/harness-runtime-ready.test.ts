/**
 * Fail-closed runtime readiness + needs_auth → ready probe (P0).
 */
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { HarnessManager } from './harness-manager'
import {
  assertSessionHarnessRuntimeReady,
  probeHarnessReadiness,
} from './harness-runtime-ready'

const dirs: string[] = []

afterEach(() => {
  delete process.env.SUPERONE_HARNESS_MARK_READY
  delete process.env.SUPERONE_CODEX_BINARY
  delete process.env.SUPERONE_CLAUDE_BINARY
  delete process.env.SUPERONE_ACP_BINARY
  delete process.env.SUPERONE_OPENCODE_BINARY
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'hrr-'))
  dirs.push(dir)
  const db = openNodeDatabase(join(dir, 'state.sqlite'))
  const harnesses = new HarnessManager(db)
  return { dir, db, harnesses }
}

function fakeBinary(dir: string, name: string): string {
  const p = join(dir, name)
  writeFileSync(p, '#!/bin/sh\necho ok\n')
  chmodSync(p, 0o755)
  return p
}

describe('assertSessionHarnessRuntimeReady', () => {
  it('fails closed for codex without binary', () => {
    const { harnesses } = boot()
    const r = assertSessionHarnessRuntimeReady('codex', harnesses)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/codex runtime unavailable/)
  })

  it('accepts SUPERONE_CODEX_BINARY', () => {
    const { dir, harnesses } = boot()
    const bin = fakeBinary(dir, 'codex')
    process.env.SUPERONE_CODEX_BINARY = bin
    const r = assertSessionHarnessRuntimeReady('codex', harnesses)
    expect(r.ok).toBe(true)
  })
})

describe('probeHarnessReadiness', () => {
  it('promotes needs_auth → ready with MARK_READY lab flag', () => {
    const { dir, harnesses } = boot()
    const bin = fakeBinary(dir, 'claude-bin')
    harnesses.update('claude', {
      enabled: true,
      state: 'needs_auth',
      command: bin,
      diagnosticCode: 'needs_auth',
    })
    process.env.SUPERONE_HARNESS_MARK_READY = '1'
    const result = probeHarnessReadiness(harnesses, 'claude', null)
    expect(result.ok).toBe(true)
    expect(result.transitioned).toBe(true)
    expect(result.state).toBe('ready')
    expect(harnesses.get('claude').state).toBe('ready')
  })

  it('demotes ready → error when binary missing', () => {
    const { harnesses } = boot()
    harnesses.update('codex', {
      enabled: true,
      state: 'ready',
      command: '/nonexistent/codex-binary-xyz',
    })
    const result = probeHarnessReadiness(harnesses, 'codex', null)
    expect(result.ok).toBe(false)
    expect(result.state).toBe('error')
  })
})
