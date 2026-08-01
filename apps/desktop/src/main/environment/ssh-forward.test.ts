import { describe, expect, it } from 'vitest'
import { findFreePort } from './ssh-forward'

describe('ssh-forward', () => {
  it('allocates an ephemeral free local port', async () => {
    const a = await findFreePort()
    const b = await findFreePort()
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    // May collide rarely; at least both are valid ports
    expect(a).toBeLessThan(65536)
  })
})
