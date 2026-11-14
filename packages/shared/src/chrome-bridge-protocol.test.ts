import { describe, expect, it } from 'vitest'
import {
  ChromeBridgeChunkAssembler,
  chromeNativeHostName,
  chromeTabRef,
  isChromeTabId,
  parseChromeTabRef,
  splitChromeBridgeMessage,
} from './chrome-bridge-protocol'

describe('chrome bridge protocol', () => {
  it('names the native host per variant', () => {
    expect(chromeNativeHostName('stable')).toBe('com.superone.browser_bridge')
    expect(chromeNativeHostName('dev')).toBe('com.superone.browser_bridge.dev')
    expect(chromeNativeHostName('alpha')).toBe('com.superone.browser_bridge.alpha')
  })

  it('round-trips a chrome tab id', () => {
    expect(isChromeTabId(chromeTabRef(12))).toBe(true)
    expect(parseChromeTabRef('chrome:12')).toBe(12)
    expect(isChromeTabId('browser-1')).toBe(false)
    expect(() => parseChromeTabRef('chrome:nope')).toThrow(/Invalid Chrome tab id/)
  })

  it('splits and rejoins a message larger than one native-messaging frame', () => {
    const json = JSON.stringify({ id: 1, result: { data: 'x'.repeat(600_000) } })
    const parts = splitChromeBridgeMessage(json, 'shot', 512 * 1024)
    expect(parts.length).toBeGreaterThan(1)
    const assembler = new ChromeBridgeChunkAssembler()
    let joined: string | null = null
    for (const part of parts) joined = assembler.accept(JSON.parse(part))
    expect(joined).toBe(json)
  })
})
