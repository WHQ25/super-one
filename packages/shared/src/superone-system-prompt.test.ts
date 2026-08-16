import { describe, expect, it } from 'vitest'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from './superone-system-prompt'

describe('SUPERONE_SYSTEM_PROMPT_APPEND', () => {
  it('requires tags on the first session_rename and allows inventing labels', () => {
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/session_rename/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/Always include `tags`/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).toMatch(/invent/)
    expect(SUPERONE_SYSTEM_PROMPT_APPEND).not.toMatch(/do not invent/i)
  })
})
