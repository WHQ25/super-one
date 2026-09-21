import { describe, expect, it } from 'vitest'
import { availableMentionCapabilityIds, mentionCapabilityAvailability } from '@superone/shared/mention-capabilities'
import { buildMentionRows } from './mention-rows'
import { mentionTokenFromItem } from './mention-selection'

const paths = (query: string, capabilityIds?: unknown) =>
  buildMentionRows(query, { remote: [], agentProfiles: [], capabilityIds }).map((row) => row.item.path)

const enabled = (query: string, capabilityIds?: unknown) =>
  buildMentionRows(query, { remote: [], agentProfiles: [], capabilityIds })
    .filter((row) => !row.disabled).map((row) => row.item.path)

describe('host capability settings to mobile mention menu', () => {
  it('enables computer and browser only when the connected host has them on', () => {
    const ids = availableMentionCapabilityIds({ computerUseEnabled: true, cdpEnabled: true }, 'darwin')
    // Session and Git portals are independent of host capability settings.
    expect(enabled('', ids)).toEqual(['computer', 'browser', 'widget', 'debug', 'session', 'git', 'gh'])
    expect(mentionTokenFromItem(buildMentionRows('computer use', { remote: [], agentProfiles: [], capabilityIds: ids })[0]!.item)?.kind)
      .toBe('computer')
    expect(enabled('browser', availableMentionCapabilityIds({ cdpEnabled: false }, 'darwin'))).toEqual([])
  })

  it('lists a disabled capability rather than hiding it', () => {
    // Hiding it makes the feature look absent; the row says why it cannot be used.
    const ids = availableMentionCapabilityIds({ cdpEnabled: false }, 'darwin')
    expect(paths('browser', ids)).toEqual(['browser'])
    expect(buildMentionRows('browser', { remote: [], agentProfiles: [], capabilityIds: ids })[0]?.disabled).toBe(true)
  })

  it('uses the host platform and retains safe legacy-host behavior', () => {
    expect(mentionCapabilityAvailability({ computerUseEnabled: true }, 'win32').computer).toBe(false)
    expect(enabled('')).toEqual(['widget', 'debug', 'session', 'git', 'gh'])
    expect(enabled('', [])).toEqual(['session', 'git', 'gh'])
    expect(enabled('', ['unknown', 'browser', null])).toEqual(['browser', 'session', 'git', 'gh'])
  })
})
