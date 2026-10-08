import { describe, expect, it } from 'vitest'
import { EventBuffer } from './buffer'

describe('EventBuffer buffer-first', () => {
  it('holds events until history+snapshot then bumps epoch', () => {
    const b = new EventBuffer()
    b.start()
    b.push([{ type: 'live' }])
    expect(b.isBuffering).toBe(true)
    const { epoch, batches } = b.release()
    expect(epoch).toBe(1)
    expect(batches).toEqual([[{ type: 'live' }]])
    expect(b.isBuffering).toBe(false)
  })

  it('does not discard reconnect frames when restore starts buffering again', () => {
    const b = new EventBuffer()
    b.start()
    b.push([{ type: 'during-connect' }])
    b.start()
    expect(b.release().batches).toEqual([[{ type: 'during-connect' }]])
  })
})
