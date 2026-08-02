import { describe, expect, it } from 'vitest'
import {
  LOCAL_ENVIRONMENT_CAPABILITIES,
  PHASE1_NODE_CAPABILITIES,
  intersectCapabilities,
  normalizeCapabilities,
} from './capabilities'

describe('normalizeCapabilities', () => {
  it('defaults missing flags to false and harnessIds to []', () => {
    expect(normalizeCapabilities({})).toEqual({
      sessions: false,
      harnessIds: [],
      terminal: false,
      workspaceFs: false,
      git: false,
      worktrees: false,
      mcp: false,
      fileTransfer: false,
      collaboration: false,
      nodeAdmin: false,
      coldSessionResume: false,
      turnReattach: false,
      hostActionV1: false,
    })
  })

  it('ignores unknown keys and invalid harness ids', () => {
    const result = normalizeCapabilities({
      sessions: true,
      harnessIds: ['claude', 'unknown', 42, 'codex'],
      futureFlag: true,
      terminal: 1,
    })
    expect(result.sessions).toBe(true)
    expect(result.harnessIds).toEqual(['claude', 'codex'])
    expect(result.terminal).toBe(true)
    expect('futureFlag' in result).toBe(false)
  })
})

describe('intersectCapabilities', () => {
  it('ANDs flags and intersects harness lists', () => {
    const result = intersectCapabilities(LOCAL_ENVIRONMENT_CAPABILITIES, PHASE1_NODE_CAPABILITIES)
    expect(result.sessions).toBe(false)
    expect(result.terminal).toBe(true)
    expect(result.harnessIds).toEqual([])
    expect(result.nodeAdmin).toBe(false)
  })
})

describe('LOCAL_ENVIRONMENT_CAPABILITIES', () => {
  it('exposes the four product harnesses for local desktop', () => {
    expect(LOCAL_ENVIRONMENT_CAPABILITIES.sessions).toBe(true)
    expect(LOCAL_ENVIRONMENT_CAPABILITIES.harnessIds).toEqual(['claude', 'codex', 'acp', 'opencode'])
  })
})
