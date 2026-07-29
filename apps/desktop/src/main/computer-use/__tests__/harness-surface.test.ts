import { describe, it, expect } from 'vitest'
import {
  COMPUTER_USE_HARNESS_IDS,
  bareComputerUseToolNames,
  computerUseQualifiedNames,
  harnessRecoveryForComputerUseToggle,
  isComputerUseQualifiedName,
} from '../harness-surface'
import { COMPUTER_USE_TOOL_NAMES } from '../tools'

/**
 * Pure harness-matrix tests (no Electron). Tool listing is covered in
 * contract.test.ts + listSuperoneMcpTools when the feature flag is on.
 */
describe('Computer Use harness surface', () => {
  it('covers all four SuperOne harnesses', () => {
    expect([...COMPUTER_USE_HARNESS_IDS].sort()).toEqual(
      ['acp', 'claude', 'codex', 'opencode'].sort(),
    )
  })

  it('exposes exactly six bare tool names shared by every surface', () => {
    expect(bareComputerUseToolNames()).toEqual([...COMPUTER_USE_TOOL_NAMES])
    expect(COMPUTER_USE_TOOL_NAMES).toHaveLength(6)
  })

  it('qualified names use mcp__superone__ prefix (Claude permission path)', () => {
    const q = computerUseQualifiedNames()
    expect(q).toContain('mcp__superone__computer_apps')
    expect(q).toContain('mcp__superone__computer_act')
    expect(q).toHaveLength(6)
    expect(q.every((n) => n.startsWith('mcp__superone__computer_'))).toBe(true)
    expect(isComputerUseQualifiedName('mcp__superone__computer_snapshot')).toBe(true)
    expect(isComputerUseQualifiedName('mcp__superone__browser_click')).toBe(false)
  })

  it('every known harness recovery requires rebuild + http close + notify', () => {
    for (const id of COMPUTER_USE_HARNESS_IDS) {
      const r = harnessRecoveryForComputerUseToggle(id)
      expect(r, id).toEqual({
        markNeedsRebuild: true,
        closeHttpSessions: true,
        notifyToolsChanged: true,
      })
    }
  })

  it('unknown harness still notifies tools changed (forward compatible)', () => {
    expect(harnessRecoveryForComputerUseToggle('future-harness')).toEqual({
      markNeedsRebuild: false,
      closeHttpSessions: false,
      notifyToolsChanged: true,
    })
  })
})
