/**
 * Unified miniapp_call permission model (executor-owned):
 *
 * - All harnesses **statically admit** mcp__superone__miniapp_call (host-owned)
 * - Real allow/prompt runs in the executor via preapprove + host permission_request
 * - Codex elicitation therefore auto-accepts (no args needed); non-preapproved
 *   calls still prompt via Session.emitHostEvent (session_agents_confirm path)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({}))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function (this: Record<string, unknown>) {
    this.tool = vi.fn()
    this.registerTool = vi.fn(() => ({ remove: vi.fn() }))
    this.sendToolListChanged = vi.fn()
    this.isConnected = vi.fn(() => false)
  }),
}))
vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({}),
}))
vi.mock('../miniapp/miniapp-service', () => ({
  createMiniApp: vi.fn(),
  cacheAppEntry: vi.fn(),
}))
vi.mock('../miniapp/miniapp-packager', () => ({
  packApp: vi.fn(),
  getPreapprovedByPath: vi.fn(async () => ['render_data']),
}))
vi.mock('./guides/overview.md?raw', () => ({ default: 'overview' }))
vi.mock('./guides/manifest.md?raw', () => ({ default: 'manifest' }))
vi.mock('./guides/permissions.md?raw', () => ({ default: 'permissions' }))
vi.mock('./guides/api/theme.md?raw', () => ({ default: 'theme' }))
vi.mock('./guides/api/locale.md?raw', () => ({ default: 'locale' }))
vi.mock('./guides/api/agent.md?raw', () => ({ default: 'agent' }))
vi.mock('./guides/api/system.md?raw', () => ({ default: 'system' }))
vi.mock('./guides/api/ui.md?raw', () => ({ default: 'ui' }))
vi.mock('./guides/api/host.md?raw', () => ({ default: 'miniapp-host' }))
vi.mock('./guides/packaging.md?raw', () => ({ default: 'packaging' }))
vi.mock('./guides/icon.md?raw', () => ({ default: 'icon' }))
vi.mock('./guides/recipes.md?raw', () => ({ default: 'recipes' }))
vi.mock('./guides/tools.md?raw', () => ({ default: 'tools' }))

import {
  isBuiltInSuperoneTool,
  isAppToolPreapprovedForSession,
  loadPreapprovedTools,
  markAppToolPreapproved,
  registerAppTools,
  unregisterAppTools,
} from './superone-mcp-server'
import { MINIAPP_CALL_QUALIFIED } from './miniapp-call-policy'
import { listOpenCodeAutoAllowSuperoneBareNames } from './superone-host-owned-tools'
import { shouldAutoAllowAcpPermission } from '../acp/acp-permission-preapprove'

const SID = 'perm-path-session'
const APP = 'hello'
const TOOL_OK = 'render_data'
const TOOL_OTHER = 'secret_tool'

function makeTools(): MiniAppToolDefinition[] {
  return [
    { name: TOOL_OK, description: 'Render', inputSchema: { type: 'object', properties: {} } },
    { name: TOOL_OTHER, description: 'Secret', inputSchema: { type: 'object', properties: {} } },
  ]
}

function acpWouldAutoAllowMiniappCall(): boolean {
  const params: RequestPermissionRequest = {
    sessionId: SID,
    toolCall: {
      toolCallId: 'tc1',
      title: 'use_tool',
      rawInput: {
        tool_name: 'superone__miniapp_call',
        tool_input: { appId: APP, tool: TOOL_OTHER, input: {} },
      },
    },
    options: [
      { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
    ],
  }
  return shouldAutoAllowAcpPermission(params).allow
}

beforeEach(async () => {
  unregisterAppTools(SID, APP)
  registerAppTools(SID, '/proj', APP, 'hello', makeTools())
  await loadPreapprovedTools(APP, 'hello', '/fake/install')
})

describe('miniapp_call unified static-admit + executor gate', () => {
  it('all four harnesses statically admit miniapp_call (host-owned / OpenCode allow)', () => {
    expect(isBuiltInSuperoneTool(MINIAPP_CALL_QUALIFIED)).toBe(true)
    expect(isBuiltInSuperoneTool('mcp__superone__miniapp_list')).toBe(true)
    // ACP: built-in check fires regardless of tool_input (executor will gate)
    expect(acpWouldAutoAllowMiniappCall()).toBe(true)
    // OpenCode static rules include both fixed tools
    expect(listOpenCodeAutoAllowSuperoneBareNames()).toContain('miniapp_list')
    expect(listOpenCodeAutoAllowSuperoneBareNames()).toContain('miniapp_call')
  })

  it('executor preapprove distinguishes preapproved vs not (production decision site)', () => {
    expect(isAppToolPreapprovedForSession(APP, TOOL_OK)).toBe(true)
    expect(isAppToolPreapprovedForSession(APP, TOOL_OTHER)).toBe(false)
    markAppToolPreapproved(APP, TOOL_OTHER)
    expect(isAppToolPreapprovedForSession(APP, TOOL_OTHER)).toBe(true)
  })
})
