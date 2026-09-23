import type { ChatMessage, ContentBlock, CodexFileUpdateChange, CodexMcpToolCallItem, CodexThreadItem, TaskFileChange } from '@superone/shared/agent-types'
import { bashEditFileChanges } from '@superone/shared/bash-edit-diff'
import { fileMutationPath, isFileMutationTool } from '@superone/shared/file-mutation'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { isSubagentToolName, normalizeTranscriptTool } from '@superone/shared/tool-ui'
import { compactMediaToolResult, computeToolLineDelta, computeToolMeta, stripMessagesForRemote } from '../remote-content'

const SHELL_INPUT_MAX = 1024

/**
 * The collapsed row's input. Past the cap the input is blanked, except that a
 * subagent's header (name, type, team, model, description) must survive: the
 * desktop draws the name tag without expanding, and only `prompt` is ever what
 * pushes an Agent call past the cap.
 */
function shellInput(toolName: string, input: string): string {
  if (input.length <= SHELL_INPUT_MAX) return input
  if (!isSubagentToolName(toolName)) return '{}'
  try {
    const { prompt: _prompt, ...header } = JSON.parse(input) as Record<string, unknown>
    const compact = JSON.stringify(header)
    return compact.length <= SHELL_INPUT_MAX ? compact : '{}'
  } catch {
    return '{}'
  }
}

function parseInput(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function fileMutationOf(block: Extract<ContentBlock, { toolName: string }>): TaskFileChange | undefined {
  const params = parseInput(block.input)
  if (!params) return undefined
  const normalized = normalizeTranscriptTool(block.toolName, params)
  if (!isFileMutationTool(normalized.toolName)) return undefined
  const path = fileMutationPath(normalized.input) || block.toolFilePath || ''
  if (!path) return undefined
  const delta = block.toolLineDelta ?? computeToolLineDelta(block.toolName, block.input)
  return { path, added: delta?.added ?? 0, removed: delta?.removed ?? 0 }
}

/**
 * File edits made under a subagent (any depth), skipping calls that failed or
 * were denied — the same rows the desktop derives from the children it keeps.
 */
export function taskFileChanges(message: ChatMessage, containerId: string): TaskFileChange[] {
  const failed = new Set(message.content.flatMap(block =>
    block.type === 'tool_result' && (block.isError || block.summary.startsWith('[denied] ')) ? [block.toolUseId] : []))
  // Content is in stream order, so a parent always precedes its children.
  const family = new Set([containerId])
  const changes: TaskFileChange[] = []
  for (const block of message.content) {
    if (!('toolName' in block) || !block.parentToolUseId || !family.has(block.parentToolUseId)) continue
    family.add(block.toolUseId)
    if (failed.has(block.toolUseId)) continue
    // A Bash call reports its edits on the result, not in its params.
    const bashEditDiff = bashEditDiffOf(message, block.toolUseId)
    if (bashEditDiff) {
      changes.push(...bashEditFileChanges(bashEditDiff))
      continue
    }
    const change = fileMutationOf(block)
    if (change) changes.push(change)
  }
  return changes
}

function bashEditDiffOf(message: ChatMessage, toolUseId: string) {
  const result = message.content.find(block => block.type === 'tool_result' && block.toolUseId === toolUseId)
  return result?.type === 'tool_result' ? result.bashEditDiff : undefined
}

/** Whether a child block can move its container's `taskFileChanges`. */
export function isFileMutationChild(message: ChatMessage, toolUseId: string): boolean {
  if (bashEditDiffOf(message, toolUseId)) return true
  const block = message.content.find(candidate => 'toolName' in candidate && candidate.toolUseId === toolUseId)
  return !!block && 'toolName' in block && fileMutationOf(block) !== undefined
}

/**
 * Inline UI and decision prompts are visible content, not hidden tool detail.
 * `ReportFindings` belongs here too: its findings live in the input, which the
 * 1 KB shell cap would otherwise blank into `{}` and render as an empty review.
 */
export function deferTool(name: string): boolean {
  return !/widget_show|media_|imagegen|image_gen|video_gen|AskUserQuestion|Todo|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|ReportFindings/.test(name)
}

function projectedToolSummary(block: Extract<ContentBlock, { toolName: string }>): string | undefined {
  const existing = block.toolSummary?.slice(0, 160)
  if (typeof block.input !== 'string') return existing
  try {
    const parsed = JSON.parse(block.input) as Record<string, unknown>
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    if (block.toolName === 'Bash') {
      const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
      return (description || command || existing)?.slice(0, 160)
    }
    // Collapsed MCP/device/browser rows read `toolSummary`; the desktop header is the
    // agent-written description, not the ACP title.
    return (description || existing)?.slice(0, 160)
  } catch {
    return existing
  }
}

/**
 * What the workflow card draws besides the shell: the script's declared meta
 * (the script itself is stripped, so the phone cannot parse it) and the task
 * lifecycle the reducers patch onto the block. Bounded rows, no transcript text.
 */
function workflowShell(block: Extract<ContentBlock, { toolName: string }>): Partial<ContentBlock> {
  const meta = block.workflowName || block.workflowPhases ? {} : computeToolMeta({ ...block, type: 'tool_use' })
  return {
    workflowName: block.workflowName ?? meta.workflowName,
    workflowDescription: block.workflowDescription ?? meta.workflowDescription,
    workflowPhases: block.workflowPhases ?? meta.workflowPhases,
    workflowCurrentPhase: block.workflowCurrentPhase,
    workflowAgents: block.workflowAgents,
    taskSummary: block.taskSummary,
    taskDescription: block.taskDescription,
    taskUsage: block.taskUsage,
    taskStatus: block.taskStatus,
  }
}

export function projectTool(block: ContentBlock, ref: string): ContentBlock {
  if (!('toolName' in block) || !deferTool(block.toolName)) return block
  const input = sanitizeRemoteToolInput(block.toolName, block.input)
  const toolLineDelta = block.toolLineDelta ?? computeToolLineDelta(block.toolName, block.input)
  return { type: block.type, toolName: block.toolName, toolUseId: block.toolUseId,
    input: shellInput(block.toolName, input), status: block.status, elapsedSeconds: block.elapsedSeconds,
    parentToolUseId: block.parentToolUseId, startedAt: block.startedAt,
    toolSummary: projectedToolSummary(block), toolFilePath: block.toolFilePath,
    ...(toolLineDelta ? { toolLineDelta } : {}),
    ...(block.toolName === 'Workflow' ? workflowShell(block) : {}),
    // The card's collapsed badge (calls · tokens); the children behind it are not sent.
    ...(isSubagentToolName(block.toolName) ? { taskUsage: block.taskUsage, taskStatus: block.taskStatus } : {}),
    remoteDetail: ref } as ContentBlock
}
export function toolDetail(message: ChatMessage, id: string): string {
  const tool = message.content.find(block => 'toolName' in block && block.toolUseId === id)
  if (!tool || !('toolName' in tool)) throw new Error('Tool not found')
  const result = message.content.find(block => block.type === 'tool_result' && block.toolUseId === id)
  const projected = stripMessagesForRemote([{ ...message, metadata: undefined, content: [tool, ...(result ? [result] : [])] }])[0]!.content[0]
  const children = message.content.filter(block => block.type !== 'thinking' && 'parentToolUseId' in block && block.parentToolUseId === id).map(block =>
    'toolName' in block ? projectTool(block, JSON.stringify([message.id, 'tool', block.toolUseId]))
      : block.type === 'tool_result' ? { type: 'tool_result', toolUseId: block.toolUseId, summary: '', isError: block.isError } : block)
  const output = result && 'summary' in result ? result.summary : undefined
  const projectedTool = projected && 'toolName' in projected ? projected : undefined
  return JSON.stringify({
    input: projectedTool?.input ?? tool.input,
    result: output,
    // A background task's `result` is only its launch receipt; the run's own
    // output is patched onto the block when the task_notification lands.
    taskResultText: tool.taskResultText,
    childBlocks: children,
    toolDiff: projectedTool?.toolDiff,
    toolDiffTokens: projectedTool?.toolDiffTokens,
    toolLineDelta: projectedTool?.toolLineDelta,
    toolFilePath: projectedTool?.toolFilePath,
  })
}
function changeLineDelta(change: CodexFileUpdateChange): { added: number; removed: number } | undefined {
  return computeToolLineDelta('FileChange', JSON.stringify({ kind: change.kind, diff: change.diff ?? '' }))
}
function fileChangeLineDelta(changes: CodexFileUpdateChange[]): { added: number; removed: number } | undefined {
  let added = 0
  let removed = 0
  for (const change of changes) {
    const delta = changeLineDelta(change)
    if (!delta) continue
    added += delta.added
    removed += delta.removed
  }
  return added > 0 || removed > 0 ? { added, removed } : undefined
}
export function projectCodexTool(item: CodexThreadItem, ref: string): CodexThreadItem {
  if (item.type === 'collab_tool_call') return { ...item, remoteDetail: ref, prompt: undefined, childItems: undefined, agentsStates: {} }
  if (item.type === 'command_execution') return { ...item, remoteDetail: ref, command: item.command.slice(0, 160), aggregatedOutput: '', commandActions: item.commandActions?.map(action => ({ ...action, command: action.command?.slice(0, 160) })) }
  if (item.type === 'file_change') {
    const toolLineDelta = item.toolLineDelta ?? fileChangeLineDelta(item.changes)
    return { ...item, remoteDetail: ref, ...(toolLineDelta ? { toolLineDelta } : {}), changes: item.changes.map((change) => {
      const delta = changeLineDelta(change)
      return { path: change.path, kind: change.kind, ...(delta ? { toolLineDelta: delta } : {}) }
    }) }
  }
  if (item.type === 'mcp_tool_call' && deferTool(item.tool)) {
    return {
      ...item,
      remoteDetail: ref,
      arguments: sanitizeCodexMcpArguments(item),
      result: compactCodexMcpResult(item.result),
    }
  }
  return item
}

function sanitizeCodexMcpArguments(item: CodexMcpToolCallItem): unknown {
  const raw = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {})
  const sanitized = sanitizeRemoteToolInput(`mcp__${item.server}__${item.tool}`, raw)
  if (!sanitized) return {}
  try { return JSON.parse(sanitized) } catch { return {} }
}

function compactCodexMcpResult(result: CodexMcpToolCallItem['result']): CodexMcpToolCallItem['result'] | undefined {
  if (!result) return undefined
  const content = Array.isArray(result.content) ? result.content : []
  const texts = content.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const text = (entry as { text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  })
  const compact = compactMediaToolResult(texts.join('\n'))
  if (!compact) return undefined
  return { content: [{ type: 'text', text: compact }], structuredContent: result.structuredContent }
}
export function codexToolDetail(item: CodexThreadItem, ref: string): string {
  if (item.type === 'collab_tool_call') {
    const [messageId, kind, key] = JSON.parse(ref)
    const path: string[] = kind === 'nested-item' ? JSON.parse(key) : [item.id]
    const childItems = Object.fromEntries(Object.entries(item.childItems ?? {}).map(([threadId, items]) => [threadId,
      items.filter(child => child.type !== 'reasoning').map(child => projectCodexTool(child,
        JSON.stringify([messageId, 'nested-item', JSON.stringify([...path, threadId, child.id])]))),
    ]))
    return JSON.stringify({ item: { ...item, childItems }, input: JSON.stringify({ prompt: item.prompt }), result: JSON.stringify(item.agentsStates) })
  }
  if (item.type === 'command_execution') return JSON.stringify({ input: JSON.stringify({ command: item.command }), result: item.aggregatedOutput })
  if (item.type === 'file_change') {
    const first = item.changes[0]
    return JSON.stringify({
      item,
      input: JSON.stringify({ file_path: first?.path ?? '', kind: first?.kind ?? '' }),
      toolDiff: item.changes.map(change => change.diff ?? '').join('\n'),
      toolLineDelta: item.toolLineDelta ?? fileChangeLineDelta(item.changes),
    })
  }
  if (item.type === 'mcp_tool_call') return JSON.stringify({ item, input: JSON.stringify(item.arguments), result: JSON.stringify(item.result ?? item.error ?? null) })
  throw new Error('Tool not found')
}

export function nestedCodexItem(message: ChatMessage, key: string): CodexThreadItem | undefined {
  const path: unknown = JSON.parse(key)
  if (!Array.isArray(path) || !path.length || path.length % 2 !== 1 || path.some(part => typeof part !== 'string')) return undefined
  let item = message.metadata?.codex?.items.find(item => item.id === path[0])
  for (let i = 1; i < path.length && item; i += 2) {
    item = item.type === 'collab_tool_call' ? item.childItems?.[path[i]]?.find(child => child.id === path[i + 1]) : undefined
  }
  return item
}
