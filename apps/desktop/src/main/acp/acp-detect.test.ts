import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accessSync, constants } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

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
    ].join(':')
  })

  it('marks agents installed when which finds them on PATH', async () => {
    const agents = await detectBuiltinAgents()
    expect(agents.map((a) => a.id).sort()).toEqual(['gemini-cli', 'grok-build', 'opencode'])
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

