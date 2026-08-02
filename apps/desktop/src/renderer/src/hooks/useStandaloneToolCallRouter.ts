import { useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppToolCallRequest } from '@superone/shared/miniapp-types'

/**
 * Router for standalone mini-app tool calls.
 *
 * MCP server generates its own callId (randomUUID) for the pending map; SDK gives chat
 * messages their own toolUseId. Standalone tool blocks need both:
 *  - toolUseId to identify which chat block they belong to
 *  - callId to send results back to main's pending map
 *
 * MCP cannot see SDK toolUseId (cross-process), so this hook bridges the two ID spaces:
 * find the chat tool_use block matching (fullToolName, JSON.stringify(args)) and write
 * `_pendingStandaloneCalls[toolUseId] = { callId, ... }`. The block subscribes by toolUseId.
 */
function canonicalize(value: unknown): string {
  try { return JSON.stringify(value) } catch { return '' }
}

function findMatchingToolUseId(call: MiniAppToolCallRequest): string | null {
  const apps = useMiniAppStore.getState().apps
  const app = apps.find((a) => a.id === call.appId)
  if (!app) return null
  const toolDef = app.manifest.tools?.find((t) => t.name === call.toolName)
  if (!toolDef?.standalone) return null

  const slug = app.manifest.toolSlug ?? app.id
  const legacyName = `mcp__superone__${slug}__${call.toolName}`
  const fixedName = 'mcp__superone__miniapp_call'
  const argsKey = canonicalize(call.arguments ?? {})
  // miniapp_call wraps tool args under `input`
  const fixedArgsKey = canonicalize({
    appId: call.appId,
    tool: call.toolName,
    input: call.arguments ?? {},
  })
  // Agents may pass toolSlug as appId
  const fixedArgsKeySlug = canonicalize({
    appId: slug,
    tool: call.toolName,
    input: call.arguments ?? {},
  })

  const state = useChatStore.getState()
  const project = state.projectSessions[call.projectDir]
  if (!project?._activeSessionId) {
    window.app.trace?.('miniapp.standalone', 'router-no-match', {
      callId: call.callId, reason: 'no-active-session', projectDir: call.projectDir, fullName: fixedName, argsKey,
    }, call.callId)
    return null
  }
  const session = project._sessions[project._activeSessionId]
  if (!session) {
    window.app.trace?.('miniapp.standalone', 'router-no-match', {
      callId: call.callId, reason: 'session-missing', fullName: fixedName, argsKey,
    }, call.callId)
    return null
  }

  const mapped = state._pendingStandaloneCalls
  const candidates: Array<{ toolUseId: string; toolName: string; argsKey: string; alreadyMapped: boolean }> = []

  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue
      let blockArgs: unknown
      let parseOk = true
      try { blockArgs = JSON.parse(block.input) } catch { parseOk = false }
      const blockArgsKey = parseOk ? canonicalize(blockArgs) : '<unparseable>'
      const alreadyMapped = !!mapped[block.toolUseId]
      candidates.push({ toolUseId: block.toolUseId, toolName: block.toolName, argsKey: blockArgsKey, alreadyMapped })
      if (alreadyMapped || !parseOk) continue

      // Fixed surface: miniapp_call({ appId, tool, input })
      if (block.toolName === fixedName) {
        if (blockArgsKey === fixedArgsKey || blockArgsKey === fixedArgsKeySlug) {
          window.app.trace?.('miniapp.standalone', 'router-matched', {
            callId: call.callId, toolUseId: block.toolUseId, fullName: fixedName, argsKey: blockArgsKey,
          }, call.callId)
          return block.toolUseId
        }
        // Match by appId+tool when input keys differ slightly (defaults stripped by schema)
        const rec = blockArgs as Record<string, unknown>
        const blockAppId = typeof rec.appId === 'string' ? rec.appId : ''
        const blockTool = typeof rec.tool === 'string' ? rec.tool : ''
        if (
          (blockAppId === call.appId || blockAppId === slug)
          && blockTool === call.toolName
          && canonicalize(rec.input ?? {}) === argsKey
        ) {
          window.app.trace?.('miniapp.standalone', 'router-matched', {
            callId: call.callId, toolUseId: block.toolUseId, fullName: fixedName, argsKey,
          }, call.callId)
          return block.toolUseId
        }
        continue
      }

      // Legacy transcript / historical tool names
      if (block.toolName === legacyName && blockArgsKey === argsKey) {
        window.app.trace?.('miniapp.standalone', 'router-matched', {
          callId: call.callId, toolUseId: block.toolUseId, fullName: legacyName, argsKey,
        }, call.callId)
        return block.toolUseId
      }
    }
  }
  window.app.trace?.('miniapp.standalone', 'router-no-match', {
    callId: call.callId, reason: 'no-block-matched', fullName: fixedName, argsKey, candidates,
  }, call.callId)
  return null
}

export function useStandaloneToolCallRouter(): void {
  const map = useChatStore((s) => s.mapStandaloneCall)

  useEffect(() => {
    const off = window.miniapp.onToolCall((call) => {
      const toolUseId = findMatchingToolUseId(call)
      if (!toolUseId) return
      map(toolUseId, {
        callId: call.callId,
        appId: call.appId,
        projectDir: call.projectDir,
        toolName: call.toolName,
        arguments: call.arguments,
      })
    })
    return off
  }, [map])
}
