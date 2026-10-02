import { describe, expect, it } from 'vitest'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

describe('plugin_notice', () => {
  it('pins one status line per plugin and clears it on null', () => {
    let session = createDefaultChatCoreSession()
    const apply = (plugin: string, text: string | null) => {
      session = { ...session, ...applyEventToSession(session, { type: 'plugin_notice', kind: 'status', plugin, text }) }
    }

    apply('token-weather', 'context 42%')
    apply('blast-radius', 'guarding 2 paths')
    apply('token-weather', 'context 61%')
    expect(session.pluginStatus).toEqual({ 'token-weather': 'context 61%', 'blast-radius': 'guarding 2 paths' })

    apply('token-weather', null)
    expect(session.pluginStatus).toEqual({ 'blast-radius': 'guarding 2 paths' })
  })

  it('leaves logs to the transcript row and toasts to the host', () => {
    const session = createDefaultChatCoreSession()
    expect(applyEventToSession(session, { type: 'plugin_notice', kind: 'log', plugin: 'p', text: 'line' })).toEqual({})
    expect(applyEventToSession(session, { type: 'plugin_notice', kind: 'toast', plugin: 'p', text: 'hi' })).toEqual({})
  })
})
