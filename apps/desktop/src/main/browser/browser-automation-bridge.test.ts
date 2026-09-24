import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))
vi.mock('../mcp/artifact-registry', () => ({ currentHostActionConnection: () => null }))
vi.mock('./browser-tab-drivers', () => ({ rememberTabDriver: vi.fn() }))

import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { browserAutomationCall, initBrowserAutomation, resolveBrowserAutomation } from './browser-automation-bridge'

interface SentCall { callId: string; sessionId: string; op: string; input: unknown }

function fakeWindow() {
  const sent: SentCall[] = []
  const webContents = {
    send: vi.fn((channel: string, payload: SentCall) => {
      expect(channel).toBe(AgentIpcChannels.BROWSER_AUTOMATION_CALL)
      sent.push(payload)
    }),
    setBackgroundThrottling: vi.fn(),
    capturePage: vi.fn(async () => ({})),
  }
  const win = { webContents, isDestroyed: () => false, isFocused: () => true } as unknown as BrowserWindow
  initBrowserAutomation(() => win)
  return { sent, webContents }
}

describe('browserAutomationCall', () => {
  it('keeps the window compositing for a screenshot and not for other ops', async () => {
    const { sent, webContents } = fakeWindow()

    const shot = browserAutomationCall('session-a', 'screenshot', {})
    expect(webContents.setBackgroundThrottling).toHaveBeenCalledWith(false)
    resolveBrowserAutomation(sent[0]!.callId, { ok: true })
    await shot
    expect(webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)

    webContents.setBackgroundThrottling.mockClear()
    const snapshot = browserAutomationCall('session-a', 'snapshot', {})
    resolveBrowserAutomation(sent[1]!.callId, { ok: true })
    await snapshot
    expect(webContents.setBackgroundThrottling).not.toHaveBeenCalled()
  })
})
