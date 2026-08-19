import { describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
  isStaticHostOwnedSuperoneToolQualified,
  STATIC_HOST_OWNED_SUPERONE_QUALIFIED_TOOL_NAMES,
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
      expect(listed.has(`mcp__superone__${bare}`), `missing from allow list: ${bare}`).toBe(true)
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
