import { describe, expect, it } from 'vitest'
import { chatViewPrePaintScript, hostMessageIsReady } from './chat-webview-boot'

describe('chatViewPrePaintScript', () => {
  it('stamps the shell background and dark class before the document paints', () => {
    const script = chatViewPrePaintScript('#0a0a0a', 'dark')
    expect(script).toContain('"#0a0a0a"')
    expect(script).toContain('colorScheme="dark"')
    expect(script).toContain("classList.add('dark')")
    expect(script.endsWith('true;')).toBe(true)
  })

  it('clears the dark class in light mode', () => {
    const script = chatViewPrePaintScript('#fafafa', 'light')
    expect(script).toContain('"#fafafa"')
    expect(script).toContain("classList.remove('dark')")
  })
})

describe('hostMessageIsReady', () => {
  it('recognises the renderer ready ping', () => {
    expect(hostMessageIsReady('{"type":"ready"}')).toBe(true)
    expect(hostMessageIsReady('{"type":"hydrate"}')).toBe(false)
    expect(hostMessageIsReady('not-json')).toBe(false)
  })
})
