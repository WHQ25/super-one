import { describe, expect, it } from 'vitest'
import { isLocalLabAuthReconnectError, isLoopbackTarget, localLabDefaults } from './local-lab'

describe('isLoopbackTarget', () => {
  it('accepts 127.0.0.1 and localhost URLs', () => {
    expect(isLoopbackTarget('http://127.0.0.1:7789')).toBe(true)
    expect(isLoopbackTarget('http://localhost:7789/')).toBe(true)
    expect(isLoopbackTarget('ws://127.0.0.1:7789')).toBe(true)
  })

  it('rejects LAN and empty targets', () => {
    expect(isLoopbackTarget('http://192.168.1.10:7788')).toBe(false)
    expect(isLoopbackTarget('https://peer.example.com')).toBe(false)
    expect(isLoopbackTarget('')).toBe(false)
    expect(isLoopbackTarget(undefined)).toBe(false)
  })
})

describe('isLocalLabAuthReconnectError', () => {
  it('detects revoked / unauthorized reconnect failures', () => {
    expect(
      isLocalLabAuthReconnectError(
        Object.assign(new Error('client session revoked'), { code: 'unauthorized' }),
      ),
    ).toBe(true)
    expect(isLocalLabAuthReconnectError(new Error('refresh token reuse detected; session revoked'))).toBe(
      true,
    )
    expect(isLocalLabAuthReconnectError(Object.assign(new Error('x'), { code: 'revoked' }))).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isLocalLabAuthReconnectError(new Error('ECONNREFUSED'))).toBe(false)
    expect(isLocalLabAuthReconnectError(new Error('timeout'))).toBe(false)
  })
})

describe('localLabDefaults', () => {
  it('defaults to loopback :7789 and node-dev-lab home', () => {
    const prev = {
      host: process.env.SUPERONE_NODE_HOST,
      port: process.env.SUPERONE_NODE_PORT,
      home: process.env.SUPERONE_NODE_HOME,
      label: process.env.SUPERONE_NODE_LABEL,
    }
    delete process.env.SUPERONE_NODE_HOST
    delete process.env.SUPERONE_NODE_PORT
    delete process.env.SUPERONE_NODE_HOME
    delete process.env.SUPERONE_NODE_LABEL
    try {
      const d = localLabDefaults()
      expect(d.baseUrl).toBe('http://127.0.0.1:7789')
      expect(d.label).toBe('local-dev-lab')
      expect(d.nodeHome).toMatch(/node-dev-lab$/)
      expect(d.port).toBe(7789)
    } finally {
      if (prev.host !== undefined) process.env.SUPERONE_NODE_HOST = prev.host
      else delete process.env.SUPERONE_NODE_HOST
      if (prev.port !== undefined) process.env.SUPERONE_NODE_PORT = prev.port
      else delete process.env.SUPERONE_NODE_PORT
      if (prev.home !== undefined) process.env.SUPERONE_NODE_HOME = prev.home
      else delete process.env.SUPERONE_NODE_HOME
      if (prev.label !== undefined) process.env.SUPERONE_NODE_LABEL = prev.label
      else delete process.env.SUPERONE_NODE_LABEL
    }
  })
})
