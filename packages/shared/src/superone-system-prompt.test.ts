import { describe, expect, it } from 'vitest'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from './superone-system-prompt'
import { BROWSER_MEMORY_DISCOVERY_HINT, MEMORY_READ_POLICY, MEMORY_WRITE_POLICY } from './browser-memory'
import { COMPUTER_MEMORY_DISCOVERY_HINT, DEVICE_MEMORY_DISCOVERY_HINT, INTERACTION_MEMORY_TOOL_DEFS } from './interaction-memory'

describe('SUPERONE_SYSTEM_PROMPT_APPEND', () => {
  it('requires tags on the first session_rename and allows inventing labels', () => {
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/session_rename/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Always include `tags`/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/invent/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).not.toMatch(/do not invent/i)
  })

  it('points file delivery to the phone at Markdown links, not at a tool', () => {
    // The phone renders file links as chips that open the preview with save / share,
    // so the model must not look for (or wait on) a dedicated share tool.
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/file chips .* on the user's phone/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/no separate tool for sending a file to a phone/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).not.toMatch(/mobile_share_file/)
  })

  it('keeps the memory read boundary consistent across the host prompt, tools and returned hints', () => {
    const surfaces = [
      SUPERONE_SYSTEM_PROMPT_APPEND,
      BROWSER_MEMORY_DISCOVERY_HINT,
      COMPUTER_MEMORY_DISCOVERY_HINT,
      DEVICE_MEMORY_DISCOVERY_HINT,
      ...INTERACTION_MEMORY_TOOL_DEFS.filter(def => def.name.endsWith('_read')).map(def => def.description),
    ]
    for (const surface of surfaces) expect(surface).toContain(MEMORY_READ_POLICY)
    expect(MEMORY_READ_POLICY).toMatch(/sign-in.*forms.*multi-step flows/)
    expect(MEMORY_READ_POLICY).toMatch(/content is blocked/)
    expect(MEMORY_READ_POLICY).toMatch(/Skip routine reading.*scrolling.*expanding content/)
    expect(MEMORY_READ_POLICY).toMatch(/Reuse an index.*this session/)
  })

  it('requires assessment without making memory writes a completion step', () => {
    expect(MEMORY_WRITE_POLICY).toMatch(/verified, reusable, non-obvious/)
    expect(MEMORY_WRITE_POLICY).toMatch(/specific future failure.*substantial repeated investigation/)
    expect(MEMORY_WRITE_POLICY).toMatch(/When uncertain, do not write/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Before finishing.*assess whether/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Do not report assessments that result in no write/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toContain('read_manual({ domain: "product", topic: "memory" })')
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).not.toMatch(/Before ending the turn, save|one topic per task/)
    for (const def of INTERACTION_MEMORY_TOOL_DEFS.filter(def => def.name.endsWith('_write'))) {
      expect(def.description).toContain(MEMORY_WRITE_POLICY)
    }
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toContain(MEMORY_WRITE_POLICY)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).not.toMatch(/surprised|part of every browser/)
  })

  it('allows requested captures and inspection while omitting captures without user-facing value', () => {
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/user requested.*capture/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/directly supports a visual claim/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Screenshots needed to inspect content are allowed/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Omit captures that only document/)
  })

  it('tells the model how to keep a spaced media path valid Markdown', () => {
    // Device captures live under `Application Support/SuperOne …`; a bare path
    // with spaces is not a CommonMark destination and renders as literal text.
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/angle brackets/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/!\[screenshot\]\(<\/Users\/me\/Library\/Application Support\/SuperOne\/shot\.png>\)/)
  })
})
