import { describe, expect, it } from 'vitest'
import { parseUserMentions } from './user-mention-parser'
import { replaceMiniAppTagsWithMention } from './miniapp-prompt-tags'
import { mentionQueryAllowsSpaces } from './session-mention-query'
import {
  buildEnvironmentMentionCandidates,
  encodeEnvironmentMentionValue,
  environmentMentionAllowsSpaces,
  filterEnvironmentMentions,
  formatEnvironmentMentionReminder,
  isEnvironmentMentionQuery,
  parseEnvironmentMentionQuery,
  remainingEnvironmentArgumentHint,
  wrapEnvironmentMention,
  type EnvironmentMentionRole,
  type EnvironmentMentionSource,
} from './environment-mention'

const local: EnvironmentMentionSource = {
  kind: 'local', environmentId: 'local-id', label: 'This Mac', state: 'connected', installationProfile: 'local-electron',
}
const node: EnvironmentMentionSource = {
  kind: 'remote', environmentId: 'node-1', label: 'studio', state: 'connected', installationProfile: 'systemd-user',
}
const connecting: EnvironmentMentionSource = {
  kind: 'remote', environmentId: 'node-2', label: 'lab', state: 'connecting', installationProfile: 'container',
}
const upgrade: EnvironmentMentionSource = {
  kind: 'remote', environmentId: 'node-3', label: 'tower', state: 'connected', installationProfile: 'manual', nodeUpgrade: { available: true },
}
const desk: EnvironmentMentionSource = {
  kind: 'remote', environmentId: 'desk-1', label: 'Mac mini', state: 'connected', desired: false, installationProfile: 'local-electron',
}

describe('environment mention query', () => {
  it('owns @env and a name, and leaves the word environment as a plain query', () => {
    expect(isEnvironmentMentionQuery('env')).toBe(true)
    expect(isEnvironmentMentionQuery('env Mac mini')).toBe(true)
    expect(isEnvironmentMentionQuery('ENV')).toBe(true)
    expect(isEnvironmentMentionQuery('environment')).toBe(false)
    expect(isEnvironmentMentionQuery('environments')).toBe(false)
    expect(parseEnvironmentMentionQuery('env Mac mini')?.nameQuery).toBe('Mac mini')
    expect(parseEnvironmentMentionQuery('studio')).toBeNull()
    expect(remainingEnvironmentArgumentHint('env')).toBe('<name>')
    expect(remainingEnvironmentArgumentHint('env ')).toBe('<name>')
    expect(remainingEnvironmentArgumentHint('env studio')).toBeNull()
  })

  it('keeps a space only while a direct name is still a prefix of a known label', () => {
    const labels = ['Mac mini', 'studio']
    expect(environmentMentionAllowsSpaces('Mac mini', labels)).toBe(true)
    expect(environmentMentionAllowsSpaces('Mac mini ', labels)).toBe(false)
    expect(environmentMentionAllowsSpaces('env Mac mini', labels)).toBe(false)
    expect(mentionQueryAllowsSpaces('env Mac mini')).toBe(true)
    expect(mentionQueryAllowsSpaces('Mac mini', { environmentLabels: labels })).toBe(true)
    expect(mentionQueryAllowsSpaces('Mac mini ', { environmentLabels: labels })).toBe(false)
    expect(mentionQueryAllowsSpaces('environment Mac mini')).toBe(false)
  })
})

describe('environment mention catalog', () => {
  const catalog = buildEnvironmentMentionCandidates({
    environments: [desk, upgrade, connecting, node, local, { ...local, environmentId: 'a<b>', label: 'Broken id' }],
  })

  it('lists this machine, then remote nodes, then other desktops', () => {
    expect(catalog.map((row) => [row.role, row.label, row.status])).toEqual([
      ['local', 'This Mac', 'connected'],
      ['cli-node', 'studio', 'connected'],
      ['cli-node', 'lab', 'connecting'],
      ['cli-node', 'tower', 'needs-upgrade'],
      ['remote-desktop', 'Mac mini', 'offline'],
    ])
  })

  it('keeps catalog order until a name is typed, then ranks the match', () => {
    expect(filterEnvironmentMentions(catalog, '').map((row) => row.label)).toEqual(['This Mac', 'studio', 'lab', 'tower', 'Mac mini'])
    expect(filterEnvironmentMentions(catalog, 'mini').map((row) => row.label)).toEqual(['Mac mini'])
    expect(filterEnvironmentMentions(catalog, 'ip')).toEqual([])
  })
})

describe('environment mention tags', () => {
  const value = encodeEnvironmentMentionValue('cli-node', 'node-1')!
  const localValue = encodeEnvironmentMentionValue('local', 'local-id')!

  it('round-trips a chip and hides the reminder from the bubble', () => {
    const tag = wrapEnvironmentMention('studio', value)
    const reminder = formatEnvironmentMentionReminder([
      { value, displayName: 'studio' },
      { value: localValue, displayName: 'This Mac' },
    ])
    expect(parseUserMentions(`use ${tag} please${reminder}`)).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'mention', kind: 'environment', value, displayName: 'studio' },
      { type: 'text', text: ' please' },
    ])
    expect(replaceMiniAppTagsWithMention(tag)).toBe('@studio')
  })

  it('passes environmentId only for another machine', () => {
    const text = formatEnvironmentMentionReminder([
      { value, displayName: 'studio' },
      { value: localValue, displayName: 'This Mac' },
      { value, displayName: 'studio' },
      { value: 'device:phone-1', displayName: 'iPhone' },
    ])
    expect(text).toContain('environmentId: node-1')
    expect(text).toContain('Omit environmentId')
    expect(text).toContain('This Mac')
    expect(text).not.toContain('environmentId: local-id')
    expect(text).not.toContain('deviceId')
    expect(text).not.toContain('iPhone')
    expect(text.match(/studio/g)).toHaveLength(1)
  })

  it('rejects an id that would break the tag', () => {
    expect(encodeEnvironmentMentionValue('local', 'a<b>')).toBeNull()
    expect(encodeEnvironmentMentionValue('cli-node', '')).toBeNull()
    expect(encodeEnvironmentMentionValue('device' as EnvironmentMentionRole, 'phone-1')).toBeNull()
    expect(wrapEnvironmentMention('bad', 'device:phone-1')).toBe('@bad')
  })
})
