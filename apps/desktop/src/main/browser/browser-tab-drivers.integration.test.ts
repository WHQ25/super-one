/**
 * The driver map that a page-started download reads must name the session that
 * drove the tab *now*, not whoever drove it last. Every browser action path —
 * CDP (via resolvePoint), synthetic (via the renderer), and the plain
 * resolve — records the driver before the action runs, so a tab handed from
 * one session to another does not file the second session's export under the
 * first (`docs/design/session-sync-zone.md` §6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import {
  browserAutomationCall,
  initBrowserAutomation,
  noteTabDriver,
  resolvePointForSession,
  resolveBrowserWebContentsId,
  requireTabDriver,
  resolveBrowserAutomation,
} from './browser-automation-bridge'
import { collectArtifacts } from '../mcp/artifact-registry'
import { tabDriver, rememberTabDriver } from './browser-tab-drivers'

// A fake renderer: capture what the bridge sends, answer it with a fixed result.
let sent: { callId: string; op: string; sessionId: string }[] = []
function fakeWindow(answer: (op: string) => unknown) {
  const win = {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), {
      send: (_channel: string, payload: { callId: string; op: string; sessionId: string }) => {
        sent.push(payload)
        queueMicrotask(() => resolveBrowserAutomation(payload.callId, answer(payload.op)))
      },
    }),
  }
  initBrowserAutomation(() => win as never)
}

beforeEach(() => { sent = [] })

describe('tab driver recorded before every action', () => {
  it('reassigns the driver to the session that resolves a CDP click target, not the one that drove before', async () => {
    fakeWindow(() => ({ ok: true, webContentsId: 42, x: 1, y: 2 }))
    rememberTabDriver(42, 'sess-A', 'conn-A')
    const point = await resolvePointForSession('sess-B', { tab: 'browser-1', selector: '#export' })
    expect(point).toMatchObject({ webContentsId: 42 })
    expect(tabDriver(42)).toEqual({ sessionId: 'sess-B', connectionId: null })
  })

  it('records the driving node when the click runs inside a remote Host Action scope', async () => {
    fakeWindow(() => ({ ok: true, webContentsId: 7, x: 0, y: 0 }))
    await collectArtifacts('sess-R', 'call-1', async () => {
      await resolvePointForSession('sess-R', { tab: 'browser-1', selector: '#dl' })
    }, 'conn-R')
    expect(tabDriver(7)).toEqual({ sessionId: 'sess-R', connectionId: 'conn-R' })
  })

  it('records the driver for a synthetic action before it runs, via noteTabDriver', async () => {
    fakeWindow((op) => (op === 'resolveWebContentsId' ? { webContentsId: 99 } : { ok: true }))
    rememberTabDriver(99, 'sess-A', 'conn-A')
    await noteTabDriver('sess-B', 'browser-1')
    expect(tabDriver(99)).toEqual({ sessionId: 'sess-B', connectionId: null })
    expect(sent.some((s) => s.op === 'resolveWebContentsId')).toBe(true)
  })

  it('leaves the map untouched when the renderer cannot resolve the tab', async () => {
    fakeWindow(() => ({ ok: false, error: 'not attached' }))
    rememberTabDriver(5, 'sess-A', 'conn-A')
    await noteTabDriver('sess-B', 'gone').catch(() => {})
    expect(tabDriver(5)).toEqual({ sessionId: 'sess-A', connectionId: 'conn-A' })
  })

  it('waits out the gap between a cold-started view being registered and its webContents existing', async () => {
    // BrowserHostLayer registers the view from an effect, so the tab is known
    // before `webContentsIdForBrowser` can answer for it: the first resolve
    // fails with "Browser view is not attached yet" and a later one succeeds.
    let attempts = 0
    fakeWindow((op) => {
      if (op !== 'resolveWebContentsId') return { ok: true }
      attempts += 1
      return attempts < 3 ? { ok: false, error: 'Browser view is not attached yet' } : { webContentsId: 42 }
    })
    await expect(requireTabDriver('sess-C', 'browser-new')).resolves.toBe(true)
    expect(attempts).toBe(3)
    expect(tabDriver(42)).toEqual({ sessionId: 'sess-C', connectionId: null })
  })

  it('reports failure rather than swallowing it when a tab never becomes attributable', async () => {
    fakeWindow(() => ({ ok: false, error: 'Browser view is not attached yet' }))
    await expect(requireTabDriver('sess-D', 'browser-never')).resolves.toBe(false)
  })
})
