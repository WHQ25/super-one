import { describe, expect, it } from 'vitest'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import { StreamingRing } from './streaming-ring'

const event = (sessionId: string, version: number, text = 'x'): EnvironmentEventEnvelope =>
  ({ aggregateType: 'session', aggregateId: sessionId, sessionVersion: version, sequence: '1', payload: { text } }) as unknown as EnvironmentEventEnvelope

const versions = (events: EnvironmentEventEnvelope[] | null) => events?.map((e) => e.sessionVersion)

describe('StreamingRing', () => {
  it("returns a session's events above a version, and none once its message commits", () => {
    const ring = new StreamingRing()
    ring.add(event('s', 1), { messageId: 'm1' })
    ring.add(event('s', 2), { messageId: 'm1' })
    ring.add(event('s', 3), { messageId: 'm2' })
    expect(versions(ring.after('s', 1))).toEqual([2, 3])

    ring.retire('s', 'm1')
    expect(versions(ring.after('s', 2))).toEqual([3])
    // A reader that had not seen version 2 lost it to the commit.
    expect(ring.after('s', 1)).toBeNull()
  })

  it('keeps only the latest update of an item without opening a gap', () => {
    const ring = new StreamingRing()
    ring.add(event('s', 1), { messageId: 'm', supersedes: 'm:item' })
    ring.add(event('s', 2), { messageId: 'm', supersedes: 'm:item' })
    expect(versions(ring.after('s', 0))).toEqual([2])
  })

  it('evicts the oldest events past the byte cap and reports the gap', () => {
    const ring = new StreamingRing(50)
    ring.add(event('a', 1, 'aaaaaaaaaa'), { messageId: 'm' })
    ring.add(event('b', 1, 'bbbbbbbbbb'), { messageId: 'm' })
    ring.add(event('a', 2, 'cccccccccc'), { messageId: 'm' })
    expect(ring.size).toBeLessThanOrEqual(50)
    expect(ring.after('a', 0)).toBeNull()
    expect(versions(ring.after('a', 1))).toEqual([2])
    expect(versions(ring.after('b', 0))).toEqual([1])
  })

  it('drops every event of a session when its turn ends', () => {
    const ring = new StreamingRing()
    ring.add(event('s', 1), { messageId: null })
    ring.add(event('s', 2), { messageId: 'm' })
    ring.retire('s', null)
    expect(ring.all()).toEqual([])
    expect(ring.after('s', 2)).toEqual([])
  })
})
