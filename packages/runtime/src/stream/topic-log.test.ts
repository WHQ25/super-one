import { describe, expect, it } from 'vitest'
import { VersionedTopicLog } from './topic-log'

describe('VersionedTopicLog', () => {
  it('replays the changes after a reader version', () => {
    const log = new VersionedTopicLog<string>(8, 'epoch-1')
    log.append('a')
    const cursor = log.cursor()
    log.append('b')
    log.append('c')
    expect(log.since(cursor)).toEqual({ kind: 'replay', items: ['b', 'c'], cursor: { epoch: 'epoch-1', version: 3 } })
    expect(log.since(log.cursor())).toEqual({ kind: 'replay', items: [], cursor: { epoch: 'epoch-1', version: 3 } })
  })

  it('asks for the snapshot when changes are gone, from another epoch, or with no cursor', () => {
    const log = new VersionedTopicLog<number>(2, 'epoch-1')
    for (let i = 1; i <= 5; i++) log.append(i)
    expect(log.since({ epoch: 'epoch-1', version: 2 }).kind).toBe('resnapshot')
    expect(log.since({ epoch: 'epoch-1', version: 3 })).toEqual({ kind: 'replay', items: [4, 5], cursor: { epoch: 'epoch-1', version: 5 } })
    expect(log.since({ epoch: 'epoch-0', version: 5 }).kind).toBe('resnapshot')
    expect(log.since({ epoch: 'epoch-1', version: 9 }).kind).toBe('resnapshot')
    expect(log.since(null)).toEqual({ kind: 'resnapshot', cursor: { epoch: 'epoch-1', version: 5 } })
  })
})
