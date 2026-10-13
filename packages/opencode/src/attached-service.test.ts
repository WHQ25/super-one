import { describe, expect, it, vi } from 'vitest'
import { claimAttachedOpenCodeLocation } from './attached-service'

describe('attached native MCP location ownership', () => {
  it('refuses competing sessions until the last reference closes without stopping an external process', async () => {
    const close = vi.fn(async () => {})
    const server = { url: 'http://native.invalid:8080/', protocol: 'v2' as const, exited: null, close }
    const first = claimAttachedOpenCodeLocation(server, process.cwd(), 'first')
    const reference = claimAttachedOpenCodeLocation(server, process.cwd(), 'first')
    expect(() => claimAttachedOpenCodeLocation(server, process.cwd(), 'second')).toThrow('dedicated location')
    await first.close(); await first.close()
    expect(() => claimAttachedOpenCodeLocation(server, process.cwd(), 'second')).toThrow('dedicated location')
    await reference.close()
    const second = claimAttachedOpenCodeLocation(server, process.cwd(), 'second')
    await second.close()
    expect(close).toHaveBeenCalledTimes(3)
  })
})
