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
      if (bare === 'browser_tools_call') continue // deliberately harness-gated, see below
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
    // Read-only reconnaissance is auto-allowed like browser_snapshot; the host's site-trust gate
    // is what actually guards it.
    expect(isBuiltInSuperoneToolQualified('mcp__superone__browser_tools_list')).toBe(true)
    expect(listOpenCodeAutoAllowSuperoneBareNames()).toContain('browser_tools_list')
  })

  it('keeps browser_tools_call out of the SDK-level allowlists too, not just canUseTool', async () => {
    // The Claude SDK consults `allowedTools` BEFORE canUseTool, and Codex reads an
    // `approval_mode` map — excluding the name from only the canUseTool short-circuit changes
    // nothing observable. This is the assertion that catches a half-done removal.
    const { STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES, BUILT_IN_SUPERONE_TOOL_NAMES: names } =
      await import('@superone/shared/superone-host-owned-tools')
    expect(names).toContain('browser_tools_call') // still a registered tool…
    expect(STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES) // …just never a pre-approved one
      .not.toContain('mcp__superone__browser_tools_call')
    expect(STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES)
      .toContain('mcp__superone__browser_tools_list')
  })

  it('never auto-allows browser_tools_call, so page tools flow through harness permissions', () => {
    // It executes code a third-party website wrote. Site trust bounds *which* sites reach it;
    // the harness permission layer bounds each call, using controls the user already knows.
    for (const enabled of [false, true]) {
      gates.webmcp = enabled
      expect(isBuiltInSuperoneToolQualified('mcp__superone__browser_tools_call')).toBe(false)
      expect(listOpenCodeAutoAllowSuperoneBareNames()).not.toContain('browser_tools_call')
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
        if (bare === 'browser_tools_call') continue // never auto-allowed, by design
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
