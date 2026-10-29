import { describe, expect, it } from 'vitest'
import { environmentMentionEmptyLabel, environmentMentionItems } from './environment-mention'

const catalog = [
  { role: 'cli-node', id: 'node-1', label: 'studio', status: 'connected' },
  { role: 'local', id: 'local-id', label: 'This Mac', status: 'connected' },
  { role: 'remote-desktop', id: 'desk-1', label: 'Mac mini', status: 'offline' },
  { role: 'device', id: 'phone-1', label: 'iPhone', status: 'connected' },
]

describe('environment mention rows', () => {
  it('keeps this machine, remote nodes, and other desktops, and drops a phone', () => {
    expect(environmentMentionItems(catalog, '').map((item) => item.path)).toEqual([
      'cli-node:node-1',
      'local:local-id',
      'remote-desktop:desk-1',
    ])
    expect(environmentMentionItems(catalog, 'mini')[0]).toMatchObject({
      label: 'Mac mini',
      description: 'Remote desktop · offline',
    })
    expect(environmentMentionItems(catalog, '')[1]).toMatchObject({
      description: 'This machine · connected',
    })
  })

  it('uses a different empty sentence when no machine can be mentioned', () => {
    expect(environmentMentionEmptyLabel(0)).toBe('No machines to mention')
    expect(environmentMentionEmptyLabel(2)).toBe('No matching environments')
  })
})
