import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { BUILT_IN_SUPERONE_TOOL_NAMES } from '../mcp/superone-mcp-builtin-defs'
import {
  grokSessionPermissionMeta,
  grokYoloModeNotificationParams,
  shouldAutoAllowAcpPermission,
  toClaudeMcpToolName,
} from './acp-permission-preapprove'
import { isHiddenAcpPermissionSlashCommand } from './acp-slash-filter'

// Avoid importing superone-mcp-server (pulls electron). Mirror real built-in names.
vi.mock('../mcp/superone-mcp-server', () => {
  const builtins = new Set([
    ...BUILT_IN_SUPERONE_TOOL_NAMES.map((n) => `mcp__superone__${n}`),
    'mcp__superone__mobile_share_file',
  ])
  return {
    isBuiltInSuperoneTool: (name: string) => builtins.has(name) || name === 'mcp__superone__miniapp_list',
    isToolPreapproved: (name: string, input: Record<string, unknown> = {}) => {
      if (name === 'mcp__superone__myapp__do_thing') return true
      if (name === 'mcp__superone__miniapp_call') {
        return input.appId === 'myapp' && input.tool === 'do_thing'
      }
      return false
    },
  }
})

function perm(partial: {
  title?: string
  kind?: string
  rawInput?: Record<string, unknown>
  meta?: Record<string, unknown>
}): RequestPermissionRequest {
  return {
    sessionId: 's1',
    toolCall: {
      toolCallId: 'tc1',
      title: partial.title,
      kind: partial.kind as never,
      rawInput: partial.rawInput,
      _meta: partial.meta,
    },
    options: [
      { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
    ],
  }
}

describe('toClaudeMcpToolName', () => {
  it('passes through mcp__ form', () => {
    expect(toClaudeMcpToolName('mcp__superone__session_rename')).toBe('mcp__superone__session_rename')
  })

  it('prefixes Grok server__tool form', () => {
    expect(toClaudeMcpToolName('superone__session_rename')).toBe('mcp__superone__session_rename')
  })

  it('returns null for bare non-MCP names', () => {
    expect(toClaudeMcpToolName('run_terminal_command')).toBeNull()
  })
})

describe('shouldAutoAllowAcpPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto-allows Grok use_tool envelope for built-in SuperOne tools', () => {
    const result = shouldAutoAllowAcpPermission(perm({
      title: 'use_tool',
      kind: 'other',
      rawInput: {
        tool_name: 'superone__session_rename',
        tool_input: { title: 'Hello' },
      },
      meta: {
        'x.ai/tool': { name: 'use_tool', kind: 'use_tool', namespace: 'grok_build' },
      },
    }))
    expect(result).toEqual({
      allow: true,
      reason: 'builtin',
      toolName: 'mcp__superone__session_rename',
    })
  })

  it('auto-allows preapproved mini-app tools via legacy namespaced name', () => {
    const result = shouldAutoAllowAcpPermission(perm({
      rawInput: { tool_name: 'superone__myapp__do_thing', tool_input: {} },
    }))
    expect(result).toEqual({
      allow: true,
      reason: 'preapproved',
      toolName: 'mcp__superone__myapp__do_thing',
    })
  })

  it('auto-allows preapproved miniapp_call by appId+tool args', () => {
    const result = shouldAutoAllowAcpPermission(perm({
      rawInput: {
        tool_name: 'superone__miniapp_call',
        tool_input: { appId: 'myapp', tool: 'do_thing', input: {} },
      },
    }))
    expect(result).toEqual({
      allow: true,
      reason: 'preapproved',
      toolName: 'mcp__superone__miniapp_call',
    })
  })

  it('does not auto-allow miniapp_call for a non-preapproved app tool', () => {
    expect(shouldAutoAllowAcpPermission(perm({
      rawInput: {
        tool_name: 'superone__miniapp_call',
        tool_input: { appId: 'other', tool: 'x', input: {} },
      },
    })).allow).toBe(false)
  })

  it('does not auto-allow third-party MCP', () => {
    expect(shouldAutoAllowAcpPermission(perm({
      rawInput: { tool_name: 'GitHub__list_issues', tool_input: {} },
    })).allow).toBe(false)
  })

  it('does not auto-allow bash / native tools', () => {
    expect(shouldAutoAllowAcpPermission(perm({
      title: 'run_terminal_command',
      kind: 'execute',
      rawInput: { command: 'ls' },
    })).allow).toBe(false)
  })

  it('does not auto-allow non-preapproved mini-app tools', () => {
    expect(shouldAutoAllowAcpPermission(perm({
      rawInput: { tool_name: 'superone__otherapp__x', tool_input: {} },
    })).allow).toBe(false)
  })

  it('auto-allows every real SuperOne built-in via Grok use_tool envelope', () => {
    expect(BUILT_IN_SUPERONE_TOOL_NAMES.length).toBeGreaterThan(5)
    for (const name of BUILT_IN_SUPERONE_TOOL_NAMES) {
      const result = shouldAutoAllowAcpPermission(perm({
        title: 'use_tool',
        kind: 'other',
        rawInput: {
          tool_name: `superone__${name}`,
          tool_input: {},
        },
        meta: {
          'x.ai/tool': { name: 'use_tool', kind: 'use_tool', namespace: 'grok_build' },
        },
      }))
      expect(result, name).toEqual({
        allow: true,
        reason: 'builtin',
        toolName: `mcp__superone__${name}`,
      })
    }
  })
})

describe('grok permission meta helpers', () => {
  it('maps bypass to yoloMode on session/new', () => {
    expect(grokSessionPermissionMeta('bypassPermissions')).toEqual({ yoloMode: true })
    expect(grokSessionPermissionMeta('auto')).toEqual({ autoMode: true })
    expect(grokSessionPermissionMeta('default')).toEqual({})
  })

  it('maps modes to yolo notification params', () => {
    expect(grokYoloModeNotificationParams('bypassPermissions')).toMatchObject({
      yolo_mode: true,
      auto_mode: false,
      permission_mode: 'always-approve',
    })
    expect(grokYoloModeNotificationParams('auto')).toMatchObject({
      yolo_mode: false,
      auto_mode: true,
      permission_mode: 'auto',
    })
    expect(grokYoloModeNotificationParams('default')).toMatchObject({
      yolo_mode: false,
      auto_mode: false,
      permission_mode: 'ask',
    })
  })
})

describe('isHiddenAcpPermissionSlashCommand', () => {
  it('hides always-approve variants', () => {
    expect(isHiddenAcpPermissionSlashCommand('always-approve')).toBe(true)
    expect(isHiddenAcpPermissionSlashCommand('/always-approve')).toBe(true)
    expect(isHiddenAcpPermissionSlashCommand('Always-Approve')).toBe(true)
    expect(isHiddenAcpPermissionSlashCommand('compact')).toBe(false)
    expect(isHiddenAcpPermissionSlashCommand('auto')).toBe(false)
  })
})
