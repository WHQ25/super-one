import { describe, expect, it } from 'vitest'
import { availableMentionCapabilityIds, mentionCapabilityAvailability } from '@superone/shared/mention-capabilities'
import { mergeMentionItems } from './composer-state'
import { mentionTokenFromItem } from './mention-selection'

describe('host capability settings to mobile mention menu', () => {
  it('offers computer and browser only when enabled on the connected host', () => {
    const ids = availableMentionCapabilityIds({ computerUseEnabled: true, cdpEnabled: true }, 'darwin')
    const items = mergeMentionItems('', [], ids)
    expect(items.map((item) => item.path)).toEqual(['computer', 'browser', 'widget', 'debug'])
    expect(mentionTokenFromItem(mergeMentionItems('computer use', [], ids)[0]!)?.kind).toBe('computer')
    expect(mergeMentionItems('browser', [], availableMentionCapabilityIds({ cdpEnabled: false }, 'darwin'))).toEqual([])
  })
  it('uses the host platform and retains safe legacy-host behavior', () => {
    expect(mentionCapabilityAvailability({ computerUseEnabled: true }, 'win32').computer).toBe(false)
    expect(mergeMentionItems('', []).map((item) => item.path)).toEqual(['widget', 'debug'])
    expect(mergeMentionItems('', [], []).map((item) => item.path)).toEqual([])
    expect(mergeMentionItems('', [], ['unknown', 'browser', null]).map((item) => item.path)).toEqual(['browser'])
  })
})
