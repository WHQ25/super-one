import { afterEach, describe, expect, it, vi } from 'vitest'

const gates = vi.hoisted(() => ({ webmcp: false }))

vi.mock('../browser/browser-webmcp', () => ({
  isWebMcpEnabled: () => gates.webmcp,
}))
import { BUILT_IN_SUPERONE_TOOL_NAMES } from './superone-mcp-builtin-defs'
import { COMPUTER_USE_TOOL_NAMES, setComputerUseEnabledForTests } from '../computer-use/tools'
import {
  isBuiltInSuperoneToolQualified,
  isHostOwnedSuperoneBareName,
  isStaticHostOwnedSuperoneBareName,
  listAllHostOwnedSuperoneBareNamesForRecognition,
  listOpenCodeAutoAllowSuperoneBareNames,
  toQualifiedSuperoneToolName,
} from './superone-host-owned-tools'

/**
 * Cross-harness matrix for SuperOne host-owned auto-approve.
 *
 * Claude / ACP: isBuiltInSuperoneTool → isBuiltInSuperoneToolQualified
 * Codex rewrite: isHostOwnedSuperoneBareName (see also codex-turn.test extract)
 * OpenCode rules: listOpenCodeAutoAllowSuperoneBareNames (see opencode-runtime.test)
 */
describe('superone host-owned tool auto-approve matrix', () => {
  afterEach(() => {
    setComputerUseEnabledForTests(null)
    gates.webmcp = false
  })

  it('lists every static builtin + mobile_share + computer tools for recognition', () => {
    const names = listAllHostOwnedSuperoneBareNamesForRecognition()
    for (const n of BUILT_IN_SUPERONE_TOOL_NAMES) {
      expect(names).toContain(n)
    }
    expect(names).toContain('mobile_share_file')
    for (const n of COMPUTER_USE_TOOL_NAMES) {
      expect(names).toContain(n)
    }
    expect(names).toContain('computer_observe')
  })

  it('treats mobile_share_file as host-owned (not only static BUILT_IN list)', () => {
    expect(isStaticHostOwnedSuperoneBareName('mobile_share_file')).toBe(true)
    expect(isHostOwnedSuperoneBareName('mobile_share_file')).toBe(true)
    expect(isBuiltInSuperoneToolQualified('mcp__superone__mobile_share_file')).toBe(true)
  })

  it('gates computer auto-allow on feature flag but still recognizes bare names', () => {
    setComputerUseEnabledForTests(false)
    expect(isHostOwnedSuperoneBareName('computer_apps')).toBe(true)
    expect(isBuiltInSuperoneToolQualified('mcp__superone__computer_apps')).toBe(false)

    setComputerUseEnabledForTests(true)
    expect(isBuiltInSuperoneToolQualified('mcp__superone__computer_apps')).toBe(true)
    expect(isBuiltInSuperoneToolQualified('mcp__superone__computer_observe')).toBe(true)
  })

  it('auto-allows every static builtin when qualified (Claude/ACP path)', () => {
    gates.webmcp = true
    for (const bare of BUILT_IN_SUPERONE_TOOL_NAMES) {
      expect(isBuiltInSuperoneToolQualified(toQualifiedSuperoneToolName(bare)), bare).toBe(true)
    }
  })

  it('gates WebMCP auto-allow while continuing to recognize its bare name', () => {
    for (const name of ['browser_tools_list', 'browser_tools_call']) {
      expect(isHostOwnedSuperoneBareName(name)).toBe(true)
      expect(isBuiltInSuperoneToolQualified(`mcp__superone__${name}`)).toBe(false)
      expect(listOpenCodeAutoAllowSuperoneBareNames()).not.toContain(name)
    }

    gates.webmcp = true
    for (const name of ['browser_tools_list', 'browser_tools_call']) {
      expect(isBuiltInSuperoneToolQualified(`mcp__superone__${name}`)).toBe(true)
      expect(listOpenCodeAutoAllowSuperoneBareNames()).toContain(name)
    }
  })

  it('does not treat mini-app or third-party bare names as host-owned', () => {
    expect(isHostOwnedSuperoneBareName('excalidraw__clear_canvas')).toBe(false)
    expect(isHostOwnedSuperoneBareName('list_apps')).toBe(false)
    expect(isBuiltInSuperoneToolQualified('mcp__superone__excalidraw__clear_canvas')).toBe(false)
  })

  it('Codex rewrite recognition covers every host-owned bare name', () => {
    // extractSuperoneMiniAppToolName uses isHostOwnedSuperoneBareName for non-mini-app names.
    for (const bare of listAllHostOwnedSuperoneBareNamesForRecognition()) {
      expect(isHostOwnedSuperoneBareName(bare), bare).toBe(true)
    }
  })

  describe('OpenCode allow-name list', () => {
    it('includes static builtins + mobile_share always; computer only when enabled', () => {
      setComputerUseEnabledForTests(false)
      gates.webmcp = true
      const off = listOpenCodeAutoAllowSuperoneBareNames()
      for (const bare of [...BUILT_IN_SUPERONE_TOOL_NAMES, 'mobile_share_file']) {
        expect(off).toContain(bare)
      }
      expect(off).not.toContain('computer_apps')

      setComputerUseEnabledForTests(true)
      const on = listOpenCodeAutoAllowSuperoneBareNames()
      for (const bare of [...COMPUTER_USE_TOOL_NAMES, 'computer_observe']) {
        expect(on).toContain(bare)
      }
    })
  })
})
