import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessCatalogReader } from '@superone/runtime/harness'
import { resolveProductionAcpLaunch } from './harness-runners'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function executable(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grok-launch-'))
  dirs.push(dir)
  const command = join(dir, 'grok')
  writeFileSync(command, '#!/bin/sh\nexit 0\n')
  chmodSync(command, 0o755)
  return command
}

function catalog(command: string | null, enabled = true): HarnessCatalogReader {
  return {
    get: () => ({
      id: 'acp-grok',
      runtimeSource: 'external',
      enabled,
      state: enabled ? 'ready' : 'disabled',
      command: command ?? undefined,
      requiresAuth: false,
    }),
    getExternalLaunchConfig: () => (command ? { command, args: ['agent', 'stdio'] } : {}),
  }
}

describe('resolveProductionAcpLaunch', () => {
  it('uses the harness-stored grok binary and default args', () => {
    const command = executable()
    expect(resolveProductionAcpLaunch({ harnesses: catalog(command) })).toEqual({
      binaryPath: command,
      args: ['agent', 'stdio'],
      agentId: 'grok-build',
    })
  })

  it('falls back to the explicit path when the catalog has no grok', () => {
    expect(resolveProductionAcpLaunch({
      harnesses: catalog(null, false),
      acpBinaryPath: '/opt/override',
    })).toEqual({ binaryPath: '/opt/override' })
  })
})
