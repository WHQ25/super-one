import { describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
  isStaticHostOwnedSuperoneToolQualified,
  STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES,
  NEVER_AUTO_ALLOW_SUPERONE_BARE_NAMES,
  isNeverAutoAllowSuperoneBareName
} from './superone-host-owned-tools'

describe('static host-owned SuperOne tool names', () => {
  it('includes every browser tool in BUILT_IN so registration and auto-approve cannot drift', () => {
    const builtIn = new Set<string>(BUILT_IN_SUPERONE_TOOL_NAMES)
    for (const name of BROWSER_TOOL_NAMES) {
      expect(builtIn.has(name), `missing browser tool in BUILT_IN: ${name}`).toBe(true)
      expect(isStaticHostOwnedSuperoneBareName(name), name).toBe(true)
      expect(isStaticHostOwnedSuperoneToolQualified(`mcp__superone__${name}`), name).toBe(true)
    }
  })
})

describe('STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES', () => {
  it('matches the predicate exactly, so a harness allow rule cannot drift from canUseTool', () => {
    for (const qualified of STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES) {
      expect(isStaticHostOwnedSuperoneToolQualified(qualified), qualified).toBe(true)
    }
    const listed = new Set(STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES)
    for (const bare of BUILT_IN_SUPERONE_TOOL_NAMES) {
      if (isNeverAutoAllowSuperoneBareName(bare)) continue
      expect(listed.has(`mcp__superone__${bare}`), `missing from allow list: ${bare}`).toBe(true)
    }
  })

  it('withholds every never-auto-allow tool from the harness allow list', () => {
    // These are registered tools the user must still approve per call. The allow list is read by
    // the Claude SDK *before* canUseTool runs, so a name leaking in here is not caught anywhere
    // else — it just silently stops prompting.
    expect(NEVER_AUTO_ALLOW_SUPERONE_BARE_NAMES.length).toBeGreaterThan(0)
    for (const bare of NEVER_AUTO_ALLOW_SUPERONE_BARE_NAMES) {
      expect(BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[], bare).toContain(bare)
      expect(STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES, bare)
        .not.toContain(`mcp__superone__${bare}`)
    }
  })

  it('qualifies every entry and holds no duplicates', () => {
    for (const name of STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES) {
      expect(name.startsWith('mcp__superone__'), name).toBe(true)
    }
    expect(new Set(STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES).size).toBe(
      STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES.length,
    )
  })
})
