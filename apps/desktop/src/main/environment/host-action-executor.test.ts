/**
 * Production Host Action executor + consumer smoke with real executeSuperoneMcpTool path.
 * Browser layer is mocked — proves sessionId flows into the tool surface without inventing
 * a desktop SessionManager entry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => ({
  executeBrowserTool: vi.fn(async (sessionId: string, toolName: string, args: unknown) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ sessionId, toolName, args }),
      },
    ],
  })),
  isBrowserToolName: (name: string) => name.startsWith('browser_'),
  getBrowserToolDescriptors: () => [],
  clearBrowserToolHandlers: vi.fn(),
}))

vi.mock('../mcp/browser-mcp-tools', () => browser)
vi.mock('../computer-use/tools', () => ({
  executeComputerUseTool: vi.fn(),
  getComputerUseToolDescriptors: () => [],
  isComputerUseEnabled: () => false,
  isComputerUseToolName: () => false,
}))
vi.mock('../mcp/superone-mcp-server', () => ({
  dispatchAppToolCall: vi.fn(),
  executeMobileShareFileTool: vi.fn(),
  getAppToolDefs: () => new Map(),
  getSessionHost: () => null,
  getAppSettingsApplier: () => () => {},
  isMobileShareToolEnabled: () => false,
  notifyDevAppReady: vi.fn(),
}))
vi.mock('../mcp/superone-mcp-builtins', () => ({
  BUILT_IN_SUPERONE_TOOL_DEFS: [],
  BUILT_IN_SUPERONE_TOOL_NAMES: [],
  executeBuiltInSuperoneTool: vi.fn(),
}))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({ experimentalAgentCollaborationEnabled: false }),
}))

import { desktopHostActionExecutor } from './host-action-executor'
import type { ClaimHostActionResult } from '@superone/shared/environment'

describe('desktopHostActionExecutor', () => {
  afterEach(() => {
    browser.executeBrowserTool.mockClear()
  })

  it('dispatches browser_snapshot with the node sessionId (tab owner key)', async () => {
    const claimed: ClaimHostActionResult = {
      actionId: 'a1',
      version: 2,
      claimToken: 'tok',
      claimExpiresAt: Date.now() + 60_000,
      toolName: 'browser_snapshot',
      toolGroup: 'browser.read',
      args: { include: ['meta'] },
      replayPolicy: 'safe',
      sessionId: 'node-session-uuid-xyz',
      turnId: null,
    }
    const ac = new AbortController()
    const out = await desktopHostActionExecutor(claimed, ac.signal)
    expect(out.outcome).toBe('succeeded')
    expect(browser.executeBrowserTool).toHaveBeenCalledWith(
      'node-session-uuid-xyz',
      'browser_snapshot',
      { include: ['meta'] },
    )
    // getSessionHost returns null — browser path does not require a desktop Session.
  })

  it('returns failed when aborted before execute', async () => {
    const claimed: ClaimHostActionResult = {
      actionId: 'a2',
      version: 2,
      claimToken: 'tok',
      claimExpiresAt: Date.now() + 60_000,
      toolName: 'browser_snapshot',
      toolGroup: 'browser.read',
      args: {},
      replayPolicy: 'safe',
      sessionId: 's',
      turnId: null,
    }
    const ac = new AbortController()
    ac.abort()
    const out = await desktopHostActionExecutor(claimed, ac.signal)
    expect(out.outcome).toBe('failed')
    expect(browser.executeBrowserTool).not.toHaveBeenCalled()
  })
})
