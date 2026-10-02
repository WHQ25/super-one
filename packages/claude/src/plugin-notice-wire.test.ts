import { describe, expect, it } from 'vitest'
import { mapPluginErrors, mapPluginUiMessage } from './plugin-notice-wire'

describe('mapPluginUiMessage', () => {
  it('maps a mod log, toast and status', () => {
    expect(mapPluginUiMessage({ type: 'system', subtype: 'ui_log', plugin: 'probe', text: 'loaded', uuid: 'u', session_id: 's' }))
      .toEqual({ type: 'plugin_notice', kind: 'log', plugin: 'probe', text: 'loaded' })
    expect(mapPluginUiMessage({ type: 'system', subtype: 'ui_toast', plugin: 'probe', text: 'hi', timeout_ms: 4000 }))
      .toEqual({ type: 'plugin_notice', kind: 'toast', plugin: 'probe', text: 'hi', timeoutMs: 4000 })
    expect(mapPluginUiMessage({ type: 'system', subtype: 'ui_status', plugin: 'probe', text: 'busy' }))
      .toEqual({ type: 'plugin_notice', kind: 'status', plugin: 'probe', text: 'busy' })
  })

  it('reads a null status as clearing the line', () => {
    expect(mapPluginUiMessage({ subtype: 'ui_status', plugin: 'probe', text: null }))
      .toEqual({ type: 'plugin_notice', kind: 'status', plugin: 'probe', text: null })
  })

  it('drops frames it cannot attribute or show, and the remote-surface ones', () => {
    expect(mapPluginUiMessage({ subtype: 'ui_log', text: 'no plugin' })).toBeNull()
    expect(mapPluginUiMessage({ subtype: 'ui_toast', plugin: 'probe', text: '' })).toBeNull()
    expect(mapPluginUiMessage({ subtype: 'ui_invalidate', plugin: 'probe', event: 'ui.render' })).toBeNull()
  })
})

describe('mapPluginErrors', () => {
  const errors = [
    { plugin: 'token-weather@acme', type: 'hook-load-failed', message: 'register.js not found' },
    { plugin: 'inline[0]', type: 'path-not-found', message: 'no such directory', path: '/tmp/x' },
  ]

  it('reports each error once per runtime although init repeats every turn', () => {
    const reported = new Set<string>()
    expect(mapPluginErrors(errors, reported)).toEqual([
      { type: 'plugin_notice', kind: 'log', plugin: 'token-weather@acme', text: 'register.js not found', level: 'error' },
      { type: 'plugin_notice', kind: 'log', plugin: 'inline[0]', text: 'no such directory', level: 'error' },
    ])
    expect(mapPluginErrors(errors, reported)).toEqual([])
  })

  it('treats an absent key as a clean load', () => {
    expect(mapPluginErrors(undefined, new Set())).toEqual([])
  })
})
