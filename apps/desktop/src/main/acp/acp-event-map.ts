import type { AgentEvent, ContentBlock, SlashCommandInfo } from '@superone/shared/agent-types'
import type { SessionConfigOption, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'
import { extractModeConfig, extractModelConfig } from './acp-config'

export interface AcpMapContext {
  messageId: string
}

function textFromContent(content: { type?: string; text?: string } | undefined): string {
  if (!content) return ''
  if (content.type === 'text' && typeof content.text === 'string') return content.text
  return ''
}

function toolInputJson(raw: unknown): string {
  if (raw == null) return '{}'
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return '{}'
  }
}

function toolUseBlock(tool: ToolCall | ToolCallUpdate, titleFallback: string): ContentBlock {
  const toolName =
    (typeof (tool as ToolCall).title === 'string' && (tool as ToolCall).title)
    || (typeof tool.kind === 'string' && tool.kind)
    || titleFallback
  const status =
    tool.status === 'completed' || tool.status === 'failed'
      ? 'complete'
      : 'streaming'
  return {
    type: 'tool_use',
    toolName,
    toolUseId: tool.toolCallId,
    input: toolInputJson(tool.rawInput),
    status,
    toolSummary: typeof (tool as ToolCall).title === 'string' ? (tool as ToolCall).title : undefined,
    toolFilePath: tool.locations?.[0]?.path,
  }
}

function toolResultFromUpdate(update: ToolCallUpdate): ContentBlock | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null
  const parts: string[] = []
  for (const item of update.content ?? []) {
    if (item.type === 'content' && item.content?.type === 'text') {
      parts.push(item.content.text)
    } else if (item.type === 'diff') {
      parts.push(`diff ${item.path ?? ''}`.trim())
    }
  }
  if (update.rawOutput != null && parts.length === 0) {
    parts.push(typeof update.rawOutput === 'string' ? update.rawOutput : toolInputJson(update.rawOutput))
  }
  return {
    type: 'tool_result',
    toolUseId: update.toolCallId,
    summary: parts.join('\n').slice(0, 4000) || (update.status === 'failed' ? 'failed' : 'done'),
    isError: update.status === 'failed',
  }
}

/** Map one ACP session update into zero or more SuperOne AgentEvents. */
export function mapSessionUpdate(update: SessionUpdate, ctx: AcpMapContext): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textFromContent(update.content)
      if (!text) return []
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: { type: 'text', text },
      }]
    }
    case 'agent_thought_chunk': {
      const text = textFromContent(update.content)
      if (!text) return []
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: { type: 'thinking', thinking: text },
      }]
    }
    case 'tool_call': {
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: toolUseBlock(update, 'tool'),
      }]
    }
    case 'tool_call_update': {
      const events: AgentEvent[] = []
      if (update.title || update.kind || update.rawInput !== undefined || update.status === 'in_progress' || update.status === 'pending') {
        events.push({
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: toolUseBlock(update, 'tool'),
        })
      }
      const result = toolResultFromUpdate(update)
      if (result) {
        events.push({
          type: 'content_delta',
          messageId: ctx.messageId,
          delta: result,
        })
      }
      return events
    }
    case 'plan': {
      const lines = (update.entries ?? []).map((e) => {
        const mark = e.status === 'completed' ? 'x' : e.status === 'in_progress' ? '~' : ' '
        return `- [${mark}] ${e.content}`
      })
      if (lines.length === 0) return []
      return [{
        type: 'content_delta',
        messageId: ctx.messageId,
        delta: { type: 'text', text: `\n${lines.join('\n')}\n` },
      }]
    }
    case 'config_option_update': {
      const configOptions = (update as { configOptions?: SessionConfigOption[] }).configOptions
      if (!configOptions?.length) return []
      const events: AgentEvent[] = []
      const models = extractModelConfig(configOptions)
      if (models) {
        events.push({
          type: 'acp_models',
          models: models.models,
          selectedModelId: models.selectedModelId,
          configId: models.configId,
          status: 'ready',
        })
      }
      const modes = extractModeConfig(configOptions)
      if (modes) {
        events.push({
          type: 'acp_modes',
          modes: modes.modes,
          selectedModeId: modes.selectedModeId,
          configId: modes.configId,
          status: 'ready',
        })
      }
      return events
    }
    case 'available_commands_update': {
      const raw = (update as { availableCommands?: unknown[] }).availableCommands
      if (!Array.isArray(raw)) return []
      const commands: SlashCommandInfo[] = []
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const c = item as {
          name?: string
          description?: string
          input?: { hint?: string } | null
        }
        if (typeof c.name !== 'string' || !c.name.trim()) continue
        const name = c.name.replace(/^\//, '').trim()
        if (!name) continue
        const hint =
          c.input && typeof c.input === 'object' && typeof c.input.hint === 'string'
            ? c.input.hint
            : ''
        commands.push({
          name,
          description: typeof c.description === 'string' ? c.description : '',
          argumentHint: hint,
          isSkill: false,
        })
      }
      return [{ type: 'acp_commands', commands }]
    }
    default:
      return []
  }
}

export function mapStopReason(stopReason: string): { complete: boolean; interrupted: boolean } {
  if (stopReason === 'cancelled') return { complete: false, interrupted: true }
  return { complete: true, interrupted: false }
}
