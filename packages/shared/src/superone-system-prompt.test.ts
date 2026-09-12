import { describe, expect, it } from 'vitest'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from './superone-system-prompt'

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

  it('tells the model how to keep a spaced media path valid Markdown', () => {
    // Device captures live under `Application Support/SuperOne …`; a bare path
    // with spaces is not a CommonMark destination and renders as literal text.
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/angle brackets/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/!\[screenshot\]\(<\/Users\/me\/Library\/Application Support\/SuperOne\/shot\.png>\)/)
  })
})
