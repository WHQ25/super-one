import { describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  isStaticHostOwnedSuperoneBareName,
  isStaticHostOwnedSuperoneToolQualified,
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
