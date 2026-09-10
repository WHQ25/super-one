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
})
