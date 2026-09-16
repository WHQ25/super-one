import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accessSync, constants, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs'
import { delimiter, join } from 'path'
import { homedir, tmpdir } from 'os'

vi.mock('../agent/resolve-cli', () => ({
  fixPath: vi.fn(),
}))

import { detectBuiltinAgents, detectAgent } from './acp-detect'

describe('acp-detect', () => {
  beforeEach(() => {
    process.env.PATH = [
      join(homedir(), '.grok', 'bin'),
      join(homedir(), '.opencode', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ].join(delimiter)
  })

  it('preserves PATH priority ahead of fallback installation directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-path-'))
    try {
      const command = join(dir, 'grok')
      writeFileSync(command, '#!/bin/sh\nexit 0\n'); chmodSync(command, 0o755)
      process.env.PATH = dir
      expect((await detectAgent({ id: 'grok-build', name: 'Grok', command: 'grok', args: [] })).resolvedPath).toBe(command)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('marks agents installed when which finds them on PATH', async () => {
    const agents = await detectBuiltinAgents()
    expect(agents.map((a) => a.id).sort()).toEqual(['grok-build', 'opencode'])
    // In this developer environment these CLIs exist; tolerate CI without them.
    for (const a of agents) {
      if (a.resolvedPath) {
        expect(a.installed).toBe(true)
        expect(() => accessSync(a.resolvedPath!, constants.X_OK)).not.toThrow()
      }
    }
  })

  it('finds grok via login PATH or known ~/.grok/bin even when process PATH is minimal', async () => {
    process.env.PATH = '/usr/bin:/bin'
    const result = await detectAgent({
      id: 'grok-build',
      name: 'Grok Build',
      command: 'grok',
      args: ['agent', 'stdio'],
    })
    const known = join(homedir(), '.grok', 'bin', 'grok')
    let hasGrok = false
    try {
      accessSync(known, constants.X_OK)
      hasGrok = true
    } catch {
      hasGrok = false
    }
    if (hasGrok) {
      expect(result.installed).toBe(true)
      expect(result.resolvedPath).toBeTruthy()
    }
  })
})

