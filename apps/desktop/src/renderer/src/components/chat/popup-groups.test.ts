import { describe, expect, it } from 'vitest'
import { BUILTIN_CAPABILITIES } from '@superone/shared/capability-prompt-tags'
import { MENTION_GROUP_ORDER } from './MentionPopup'

// `groupItems` itself now lives in `@superone/shared/popup-groups` and is
// tested there. What stays here is the desktop's own ordering claim, which the
// shared helper knows nothing about.
describe('mention group order', () => {
  it('puts built-ins first, collaborators second, and includes Widget as a built-in', () => {
    expect(MENTION_GROUP_ORDER.slice(0, 2)).toEqual(['capability', 'agent-profile'])
    expect(BUILTIN_CAPABILITIES.some((capability) => capability.id === 'widget')).toBe(true)
  })
})
