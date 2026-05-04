import { webcrypto } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { powerSaveBlocker } from 'electron'
import WebSocket from 'ws'
import { diffLines } from 'diff'
import log from './logger'
import type { AgentEvent, RemoteCommand, ContentBlock, ChatMessage, CodexThreadItem, RemoteDeviceConfig } from '../shared/agent-types'

export type { RemoteDeviceConfig }
import { trace } from './agent/event-trace'
import { readOutputFile } from './agent/claude-session-runtime'
import { initHighlighter, highlightCodeSync, highlightCodeByLang, parseAnsiTokens, type DiffTokenLine } from './remote-highlighter'
import {
  bytesToHex,
  deriveKeys,
  importRawAesKey,
  encryptPayload,
  decryptPayload,
  computeHmacToken,
  computeRoomId,
} from './remote-control-crypto'
import { LanServer, listLanIpAddresses } from './lan-server'
import { LanAdvertiser } from './lan-advertiser'
import { createLanFileTokenSigner, deriveFileTokenKeyFromExtractable, type LanFileTokenSigner } from './lan-file-token'
import { uploadFileToRelay, relayWsToHttp, type RelayUploadResult } from './relay-file-uploader'

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const MAX_RECONNECT_DELAY_MS = 30_000
const SKIPPED_EVENTS = new Set([
  'files_persisted', 'elicitation_complete', 'tool_input_delta',
  'subagent_usage', 'checkpoint_captured', 'hook_started', 'hook_complete', 'hook_progress',
  'slash_command_output', 'stream_message_start', 'stream_message_stop',
])
const THROTTLED_EVENTS = new Set(['tool_progress'])
const DRAIN_BEFORE_EVENTS = new Set(['message_complete', 'status_change', 'task_notification'])

const TOOL_RESULT_MAX_LEN = 200
const MAX_BASH_OUTPUT = 5000
const MAX_BASH_LINES = 100
const WS_CHUNK_SIZE = 800_000

const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])
const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

const TOOL_TYPE_MAP: Record<string, string> = {
  Read: 'read', Edit: 'edit', Write: 'write',
  NotebookEdit: 'notebook_edit', FileChange: 'file_change',
  Bash: 'bash', Grep: 'grep', Glob: 'glob',
  WebSearch: 'web_search', WebFetch: 'web_fetch',
  Agent: 'agent', Skill: 'skill',
}

export function computeTodoItems(toolName: string, input: string): Array<{ content: string; status: string; taskId?: string }> | undefined {
  try {
    const p = JSON.parse(input)
    if (!p || typeof p !== 'object') return undefined
    if (toolName === 'TodoWrite') {
      const todos = Array.isArray(p.todos) ? p.todos : []
      return todos.map((t: Record<string, unknown>, i: number) => ({
        content: String(t.content ?? t.subject ?? ''),
        status: String(t.status ?? 'pending'),
        taskId: String(i + 1),
      }))
    }
    if (toolName === 'TaskCreate') {
      return [{ content: String(p.subject ?? ''), status: 'pending' }]
    }
    if (toolName === 'TaskUpdate') {
      return [{ content: String(p.subject ?? ''), status: String(p.status ?? 'pending'), taskId: String(p.taskId ?? '') }]
    }
  } catch { /* ignore */ }
  return undefined
}

export function countLines(s: string): number {
  if (!s) return 0
  return s.split('\n').length
}

export function countEditDelta(oldStr: string, newStr: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of diffLines(oldStr, newStr)) {
    if (change.added) added += change.count ?? 0
    else if (change.removed) removed += change.count ?? 0
  }
  return { added, removed }
}

export function stripProjectPath(value: string, projectPath?: string): string {
  if (!projectPath) return value
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/'
  return value.includes(prefix) ? value.replaceAll(prefix, '') : value
}

export function computeToolMeta(block: ContentBlock & { type: 'tool_use' }, projectPath?: string): { toolSummary?: string; toolFilePath?: string; toolLineDelta?: { added: number; removed: number }; toolDiff?: string; toolDiffTokens?: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }; toolTodos?: Array<{ content: string; status: string; taskId?: string }>; subagentType?: string; toolPrompt?: string; runInBackground?: boolean } {
  try {
    const p = JSON.parse(block.input)
    if (!p || typeof p !== 'object') return {}
    const rawFilePath = FILE_PATH_TOOLS.has(block.toolName) ? String(p.file_path ?? p.notebook_path ?? '') : undefined
    const filePath = rawFilePath ? stripProjectPath(rawFilePath, projectPath) : undefined
    let summary: string | undefined
    let toolLineDelta: { added: number; removed: number } | undefined
    let toolDiff: string | undefined
    let toolDiffTokens: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] } | undefined
    let toolTodos: Array<{ content: string; status: string; taskId?: string }> | undefined
    switch (block.toolName) {
      case 'Read': {
        const fileName = (filePath ?? '').split('/').pop() || filePath || ''
        let meta = ''
        if (p.pages != null) meta = `Page ${p.pages}`
        else {
          const offset = p.offset != null ? Number(p.offset) : 0
          const limit = p.limit != null ? Number(p.limit) : undefined
          const start = offset || 1
          if (limit != null) meta = `L${start}–${start + limit - 1}`
          else if (offset > 0) meta = `L${offset}+`
        }
        summary = meta ? `${fileName} (${meta})` : fileName
        break
      }
      case 'Edit': {
        const oldStr = String(p.old_string ?? '')
        const newStr = String(p.new_string ?? '')
        if (oldStr || newStr) {
          const delta = countEditDelta(oldStr, newStr)
          if (delta.added > 0 || delta.removed > 0) toolLineDelta = delta
          const changes = diffLines(oldStr, newStr)
          const parts: string[] = []
          for (const change of changes) {
            const lines = change.value.replace(/\n$/, '').split('\n')
            const prefix = change.added ? '+' : change.removed ? '-' : ' '
            for (const l of lines) parts.push(`${prefix}${l}`)
          }
          toolDiff = parts.join('\n')
          if (filePath) {
            const addedTokens = newStr ? highlightCodeSync(newStr, filePath) : undefined
            const removedTokens = oldStr ? highlightCodeSync(oldStr, filePath) : undefined
            if (addedTokens || removedTokens) toolDiffTokens = { added: addedTokens ?? undefined, removed: removedTokens ?? undefined }
          }
        }
        break
      }
      case 'Write': {
        const content = String(p.content ?? '')
        if (content) {
          toolLineDelta = { added: countLines(content), removed: 0 }
          toolDiff = content.split('\n').map((l: string) => `+${l}`).join('\n')
          if (filePath) {
            const addedTokens = highlightCodeSync(content, filePath)
            if (addedTokens) toolDiffTokens = { added: addedTokens }
          }
        }
        break
      }
      case 'FileChange': {
        const diff = String(p.diff ?? '')
        const kind = String(p.kind ?? '')
        if (diff) {
          if (kind === 'add') {
            toolLineDelta = { added: countLines(diff), removed: 0 }
            toolDiff = diff.split('\n').map((l: string) => `+${l}`).join('\n')
          } else if (kind === 'delete') {
            toolLineDelta = { added: 0, removed: countLines(diff) }
            toolDiff = diff.split('\n').map((l: string) => `-${l}`).join('\n')
          } else {
            let added = 0, removed = 0
            for (const line of diff.split('\n')) {
              if (line.startsWith('+') && !line.startsWith('+++')) added++
              else if (line.startsWith('-') && !line.startsWith('---')) removed++
            }
            if (added > 0 || removed > 0) toolLineDelta = { added, removed }
            toolDiff = diff
          }
        }
        break
      }
      case 'Bash':
        summary = String(p.description ?? p.command ?? '')
        break
      case 'Grep':
        summary = `${p.pattern ?? ''}${p.path ? ` in ${String(p.path).split('/').pop()}` : ''}`
        break
      case 'Glob':
        summary = String(p.pattern ?? '')
        break
      case 'WebSearch':
        summary = String(p.query ?? '')
        break
      case 'WebFetch':
        summary = String(p.url ?? '')
        break
      case 'TodoWrite':
      case 'TaskCreate':
      case 'TaskUpdate':
        toolTodos = computeTodoItems(block.toolName, block.input)
        if (block.toolName === 'TodoWrite' && toolTodos) {
          const done = toolTodos.filter((t) => t.status === 'completed').length
          summary = `Todos (${done}/${toolTodos.length})`
        } else if (block.toolName === 'TaskCreate') {
          summary = String(p.subject ?? '')
        } else {
          summary = `${p.status ?? 'update'}: ${p.subject ?? p.taskId ?? ''}`
        }
        break
      case 'Agent':
      case 'Task':
        summary = String(p.description ?? p.name ?? '')
        return { toolSummary: summary, subagentType: p.subagent_type ? String(p.subagent_type) : undefined, toolPrompt: p.prompt ? String(p.prompt) : undefined, runInBackground: p.run_in_background === true ? true : undefined }
      case 'AskUserQuestion': {
        const questions = Array.isArray(p.questions) ? p.questions : []
        summary = `${questions.length} question${questions.length !== 1 ? 's' : ''}`
        break
      }
      case 'ToolSearch':
        summary = String(p.query ?? '')
        break
    }
    return { toolSummary: summary, toolFilePath: filePath || undefined, toolLineDelta, toolDiff, toolDiffTokens, toolTodos }
  } catch { return {} }
}

export function truncateBashOutput(text: string): string {
  const lines = text.split('\n')
  const truncated = lines.length > MAX_BASH_LINES ? lines.slice(0, MAX_BASH_LINES).join('\n') + '\n…' : text
  return truncated.length > MAX_BASH_OUTPUT ? truncated.slice(0, MAX_BASH_OUTPUT) + '…' : truncated
}

const CODE_FENCE_RE = /^(`{3,})(\w*)\n([\s\S]*?)^\1\s*$/gm

function extractCodeBlockTokens(text: string): Array<{ language: string; tokens: [string, string | null][][] | null }> | undefined {
  const results: Array<{ language: string; tokens: [string, string | null][][] | null }> = []
  for (const m of text.matchAll(CODE_FENCE_RE)) {
    const language = m[2] || ''
    const code = m[3]
    if (!code) continue
    const result = language ? highlightCodeByLang(code.replace(/\n$/, ''), language) : null
    results.push({ language: result?.lang ?? (language || 'text'), tokens: result?.tokens ?? null })
  }
  return results.length > 0 ? results : undefined
}

import { splitTextIntoBlocks } from './split-text-blocks'
export type { TextSegment, SplitResult } from './split-text-blocks'

function stripContentBlock(block: ContentBlock, bashCmds?: Map<string, string>, agentIds?: Set<string>, projectPath?: string): ContentBlock {
  if (block.type === 'text') {
    const codeBlockTokens = extractCodeBlockTokens(block.text)
    if (codeBlockTokens) return { ...block, codeBlockTokens }
    return block
  }
  if (block.type === 'thinking') return block
  if (block.type === 'tool_use') {
    const meta = computeToolMeta(block, projectPath)
    const mappedType = TOOL_TYPE_MAP[block.toolName] ?? 'tool_use'
    const keepInput = block.toolName.endsWith('__show_widget')
    return { ...block, type: mappedType, input: keepInput ? block.input : '', toolSummary: block.toolSummary ?? meta.toolSummary, toolFilePath: block.toolFilePath ?? meta.toolFilePath, toolLineDelta: block.toolLineDelta ?? meta.toolLineDelta, toolDiff: block.toolDiff ?? meta.toolDiff, toolDiffTokens: block.toolDiffTokens ?? meta.toolDiffTokens, toolTodos: block.toolTodos ?? meta.toolTodos, subagentType: meta.subagentType, toolPrompt: meta.toolPrompt, runInBackground: meta.runInBackground } as ContentBlock
  }
  if (block.type === 'tool_result') {
    if (bashCmds?.has(block.toolUseId)) {
      const cmd = bashCmds.get(block.toolUseId) ?? ''
      const raw = cmd ? `\x1b[32m$\x1b[0m ${cmd}\n${block.summary}` : block.summary
      const output = truncateBashOutput(raw)
      return { type: 'bash_result', toolUseId: block.toolUseId, summary: output, parentToolUseId: block.parentToolUseId, outputTokens: parseAnsiTokens(output) }
    }
    if (!agentIds?.has(block.toolUseId) && block.summary.length > TOOL_RESULT_MAX_LEN) {
      return { ...block, summary: block.summary.slice(0, TOOL_RESULT_MAX_LEN) + '…' }
    }
  }
  return block
}

function enrichPermissionRequest(event: AgentEvent & { type: 'permission_request' }): AgentEvent {
  const { toolName, input } = event.request
  if (toolName !== 'Edit' && toolName !== 'Write') return event
  try {
    const filePath = String(input.file_path ?? '')
    if (toolName === 'Edit') {
      const oldStr = String(input.old_string ?? '')
      const newStr = String(input.new_string ?? '')
      if (!oldStr && !newStr) return event
      const changes = diffLines(oldStr, newStr)
      const parts: string[] = []
      for (const change of changes) {
        const lines = change.value.replace(/\n$/, '').split('\n')
        const prefix = change.added ? '+' : change.removed ? '-' : ' '
        for (const l of lines) parts.push(`${prefix}${l}`)
      }
      const toolDiff = parts.join('\n')
      const delta = countEditDelta(oldStr, newStr)
      const toolLineDelta = (delta.added > 0 || delta.removed > 0) ? delta : undefined
      const addedTokens = newStr && filePath ? highlightCodeSync(newStr, filePath) : undefined
      const removedTokens = oldStr && filePath ? highlightCodeSync(oldStr, filePath) : undefined
      const toolDiffTokens = (addedTokens || removedTokens) ? { added: addedTokens ?? undefined, removed: removedTokens ?? undefined } : undefined
      return { ...event, request: { ...event.request, toolDiff, toolDiffTokens, toolLineDelta } }
    }
    if (toolName === 'Write') {
      const content = String(input.content ?? '')
      if (!content) return event
      const toolDiff = content.split('\n').map((l: string) => `+${l}`).join('\n')
      const toolLineDelta = { added: countLines(content), removed: 0 }
      const addedTokens = filePath ? highlightCodeSync(content, filePath) : undefined
      const toolDiffTokens = addedTokens ? { added: addedTokens } : undefined
      return { ...event, request: { ...event.request, toolDiff, toolDiffTokens, toolLineDelta } }
    }
  } catch { /* ignore highlight errors */ }
  return event
}

export function stripEventForRemote(event: AgentEvent, projectPath?: string): AgentEvent {
  if (event.type === 'task_notification' && event.outputFile) {
    const { resultText, toolEntries } = readOutputFile(event.outputFile, projectPath)
    if (resultText || toolEntries.length > 0) return { ...event, ...(resultText ? { resultText } : {}), ...(toolEntries.length > 0 ? { toolEntries } : {}) }
  }
  if (event.type === 'content_delta') {
    return { ...event, delta: stripContentBlock(event.delta, undefined, undefined, projectPath) }
  }
  if (event.type === 'message_start') {
    const msg = event.message
    return {
      ...event,
      message: { ...msg, content: msg.content.map((b) => stripContentBlock(b, undefined, undefined, projectPath)) },
    }
  }
  if (event.type === 'message_complete' && event.metadata) {
    const { codex: _codex, ...rest } = event.metadata
    return { ...event, metadata: rest }
  }
  if (event.type === 'permission_request') {
    return enrichPermissionRequest(event)
  }
  return event
}

function convertCodexItemsToBlocks(items: CodexThreadItem[], projectPath?: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const item of items) {
    switch (item.type) {
      case 'agent_message':
        blocks.push({ type: 'text', text: item.text } as ContentBlock)
        break
      case 'plan':
        blocks.push({ type: 'codex_plan', text: item.text, itemId: item.id } as ContentBlock)
        break
      case 'review':
        if (item.text) blocks.push({ type: 'text', text: item.text } as ContentBlock)
        break
      case 'reasoning':
        blocks.push({ type: 'thinking', thinking: item.text } as ContentBlock)
        break
      case 'command_execution': {
        const action = item.commandActions?.[0]
        const output = item.command ? `\x1b[32m$\x1b[0m ${item.command}\n${item.aggregatedOutput}` : item.aggregatedOutput
        const truncated = truncateBashOutput(output)
        let toolBlock: ContentBlock
        if (action?.type === 'read') {
          const filePath = action.path ? stripProjectPath(action.path, projectPath) : undefined
          toolBlock = { type: 'read', toolName: 'Read', toolUseId: item.id, input: '', status: 'complete', toolFilePath: filePath } as ContentBlock
        } else if (action?.type === 'search') {
          const query = action.query ?? ''
          const path = action.path ? stripProjectPath(action.path, projectPath) : undefined
          const summary = `${query}${path ? ` in ${path.split('/').pop()}` : ''}`
          toolBlock = { type: 'grep', toolName: 'Grep', toolUseId: item.id, input: '', status: 'complete', toolSummary: summary } as ContentBlock
        } else {
          toolBlock = { type: 'bash', toolName: 'Bash', toolUseId: item.id, input: '', status: 'complete', toolSummary: item.command } as ContentBlock
        }
        blocks.push(toolBlock)
        if (item.aggregatedOutput) {
          blocks.push({ type: 'bash_result', toolUseId: item.id, summary: truncated, outputTokens: parseAnsiTokens(truncated) } as ContentBlock)
        }
        break
      }
      case 'file_change':
        for (const change of item.changes) {
          const filePath = change.path ? stripProjectPath(change.path, projectPath) : ''
          const block: Record<string, unknown> = { type: 'file_change', toolName: 'FileChange', toolUseId: `${item.id}:${change.path}`, input: '', status: 'complete', toolFilePath: filePath }
          if (change.diff) {
            block.toolDiff = change.diff
            let added = 0, removed = 0
            for (const line of change.diff.split('\n')) {
              if (line.startsWith('+') && !line.startsWith('+++')) added++
              else if (line.startsWith('-') && !line.startsWith('---')) removed++
            }
            if (added > 0 || removed > 0) block.toolLineDelta = { added, removed }
            if (filePath) {
              const newLines = change.diff.split('\n').filter((l: string) => l.startsWith('+') && !l.startsWith('+++')).map((l: string) => l.slice(1)).join('\n')
              const oldLines = change.diff.split('\n').filter((l: string) => l.startsWith('-') && !l.startsWith('---')).map((l: string) => l.slice(1)).join('\n')
              const addedTokens = newLines ? highlightCodeSync(newLines, filePath) : undefined
              const removedTokens = oldLines ? highlightCodeSync(oldLines, filePath) : undefined
              if (addedTokens || removedTokens) block.toolDiffTokens = { added: addedTokens ?? undefined, removed: removedTokens ?? undefined }
            }
          }
          blocks.push(block as ContentBlock)
        }
        break
      case 'web_search':
        blocks.push({ type: 'web_search', toolName: 'WebSearch', toolUseId: item.id, input: '', status: 'complete', toolSummary: item.query } as ContentBlock)
        break
      case 'mcp_tool_call':
        blocks.push({ type: 'tool_use', toolName: `${item.server}:${item.tool}`, toolUseId: item.id, input: '', status: 'complete' } as ContentBlock)
        break
      case 'image_generation':
        blocks.push({
          type: 'codex_image_generation',
          itemId: item.id,
          status: item.status,
          ...(item.savedPath ? { savedPath: item.savedPath } : {}),
          ...(item.revisedPrompt ? { revisedPrompt: item.revisedPrompt } : {}),
        } as ContentBlock)
        break
      case 'error':
        blocks.push({ type: 'text', text: item.message } as ContentBlock)
        break
    }
  }
  return blocks
}

export function stripMessagesForRemote(messages: ChatMessage[], projectPath?: string): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.providerId === 'codex' && msg.metadata?.codex?.items?.length) {
      const converted = convertCodexItemsToBlocks(msg.metadata.codex.items, projectPath)
      const { codex: _c, ...rest } = msg.metadata
      return { ...msg, content: converted, metadata: { ...rest, ...(_c?.planApproval ? { codexPlanApproval: _c.planApproval } : {}) } }
    }
    const bashCmds = new Map<string, string>()
    const todoInputs = new Map<string, { toolName: string; input: string }>()
    const widgetIds = new Set<string>()
    const agentIds = new Set<string>()
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.toolName === 'Bash') {
        try { const p = JSON.parse(block.input); bashCmds.set(block.toolUseId, String(p.command ?? '')) } catch {}
      }
      if (block.type === 'tool_use' && TODO_TOOLS.has(block.toolName)) {
        todoInputs.set(block.toolUseId, { toolName: block.toolName, input: block.input })
      }
      if (block.type === 'tool_use' && block.toolName.endsWith('__show_widget')) {
        widgetIds.add(block.toolUseId)
      }
      if (block.type === 'tool_use' && block.toolName === 'Agent') {
        agentIds.add(block.toolUseId)
      }
    }
    return {
      ...msg,
      content: msg.content
        .filter((b) => !(b.type === 'tool_use' && TODO_TOOLS.has(b.toolName)))
        .flatMap((b) => {
          if (b.type === 'tool_result' && todoInputs.has(b.toolUseId)) {
            const entry = todoInputs.get(b.toolUseId)!
            return { type: 'todo_result' as const, toolUseId: b.toolUseId, summary: b.summary, parentToolUseId: b.parentToolUseId, todoToolName: entry.toolName, toolTodos: computeTodoItems(entry.toolName, entry.input) }
          }
          if (b.type === 'tool_result' && widgetIds.has(b.toolUseId)) return b
          if (b.type === 'text') {
            const { segments } = splitTextIntoBlocks(b.text)
            if (segments.length <= 1) return stripContentBlock(b, bashCmds, agentIds, projectPath)
            return segments.map((seg) =>
              seg.type === 'insight'
                ? { type: 'insight', title: seg.title!, content: seg.content!, parentToolUseId: b.parentToolUseId, codeBlockTokens: extractCodeBlockTokens(seg.content!) } as unknown as ContentBlock
                : stripContentBlock({ ...b, text: seg.text } as ContentBlock, bashCmds, agentIds, projectPath),
            )
          }
          return stripContentBlock(b, bashCmds, agentIds, projectPath)
        }),
      metadata: msg.metadata ? (() => { const { codex: _c, ...rest } = msg.metadata!; return { ...rest, ...(_c?.planApproval ? { codexPlanApproval: _c.planApproval } : {}) } })() : undefined,
    }
  })
}

const THROTTLE_INTERVAL_MS = 2_000

interface PairingSession {
  channelId: string
  aesKey: webcrypto.CryptoKey
  ws: WebSocket | null
  pendingCode: string | null
  pendingMobileDeviceId: string | null
  pendingDeviceName: string | null
  expiryTimer: ReturnType<typeof setTimeout>
}

export type RemoteResponder = (requestId: string, data: unknown) => Promise<void>

export interface RemoteCommandSource {
  deviceId: string
  transport: 'relay' | 'lan'
}

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand, respond: RemoteResponder, source: RemoteCommandSource) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string; transport: 'lan' | 'relay'; firstConnect: boolean }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  onRelayStatusChanged?: (connected: boolean) => void
  isPairedDevice?: (deviceId: string) => boolean
}

type DeviceTransport = 'lan' | 'relay'
type ConnectedDevice = { name: string; transports: Set<DeviceTransport> }

export class RemoteControlService {
  private relayWs: WebSocket | null = null
  private keys: { channelKeyHex: string; aesKey: webcrypto.CryptoKey } | null = null
  private fileTokenSigner: LanFileTokenSigner | null = null
  private connectedDevices = new Map<string, ConnectedDevice>()
  private lanServer: LanServer | null = null
  private lanAdvertiser: LanAdvertiser | null = null
  private currentConfig: RemoteDeviceConfig | null = null
  private sleepBlockerProcess: ChildProcess | null = null
  private powerBlockerId: number | null = null
  private pairingSession: PairingSession | null = null

  private sendQueue: Promise<void> = Promise.resolve()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1_000
  private intentionallyClosed = false

  private lastThrottledAt = new Map<string, number>()
  private bashToolCommands = new Map<string, string>()
  private todoToolInputs = new Map<string, { toolName: string; input: string }>()
  private widgetToolIds = new Set<string>()
  private agentToolIds = new Set<string>()
  private agentOutputFiles = new Map<string, string>()
  private pendingText: { messageId: string; text: string; parentToolUseId: string | null; targets?: string[] } | null = null
  private pendingTextFlushedLen = 0
  private pendingThinking: { messageId: string; text: string; parentToolUseId: string | null; targets?: string[] } | null = null

  private relayUrl = ''

  private lanFrameSeq = 0

  constructor(
    private readonly defaultRelayUrl: string,
    private readonly callbacks: RemoteControlCallbacks,
  ) {
    initHighlighter()
  }

  resume(): void {
    if (this.currentConfig) this.start(this.currentConfig)
  }

  getOnlineDevices(): Map<string, { name: string; transport: DeviceTransport }> {
    const online = new Map<string, { name: string; transport: DeviceTransport }>()
    for (const [id, info] of this.connectedDevices) {
      online.set(id, { name: info.name, transport: this.primaryTransport(info) })
    }
    return online
  }

  getLanPort(): number | null {
    return this.lanServer?.getPort() ?? null
  }

  async signLanFileUrl(realPath: string, opts: { ttlMs?: number } = {}): Promise<string | null> {
    if (!this.fileTokenSigner) return null
    const port = this.lanServer?.getPort()
    if (!port) return null
    const token = await this.fileTokenSigner.sign(realPath, opts)
    return `http://{lanHost}:${port}/files/${encodeURIComponent(token)}`
  }

  async uploadFileToRelay(
    realPath: string,
    meta: { mimeType: string; size: number },
    sessionId: string,
  ): Promise<RelayUploadResult> {
    if (!this.keys || !this.relayUrl) {
      throw new Error('Relay not connected')
    }
    return uploadFileToRelay(realPath, meta, sessionId, {
      channelKeyHex: this.keys.channelKeyHex,
      relayHttpUrl: relayWsToHttp(this.relayUrl),
    })
  }

  private primaryTransport(info: ConnectedDevice): DeviceTransport {
    return info.transports.has('lan') ? 'lan' : 'relay'
  }

  private markDeviceOnline(deviceName: string, deviceId: string, via: DeviceTransport): void {
    const current = this.connectedDevices.get(deviceId)
    if (!current) {
      this.connectedDevices.set(deviceId, { name: deviceName, transports: new Set([via]) })
      this.callbacks.onClientRegistered?.({ deviceName, deviceId, transport: via, firstConnect: true })
      return
    }
    const previousTransport = this.primaryTransport(current)
    current.name = deviceName
    current.transports.add(via)
    const nextTransport = this.primaryTransport(current)
    if (nextTransport !== previousTransport) {
      this.callbacks.onClientRegistered?.({ deviceName, deviceId, transport: nextTransport, firstConnect: false })
    }
  }

  private markDeviceOffline(deviceId: string, via: DeviceTransport): void {
    const current = this.connectedDevices.get(deviceId)
    if (!current || !current.transports.has(via)) return
    const previousTransport = this.primaryTransport(current)
    current.transports.delete(via)
    if (current.transports.size === 0) {
      this.connectedDevices.delete(deviceId)
      this.callbacks.onClientDisconnected?.({ deviceId })
      return
    }
    const nextTransport = this.primaryTransport(current)
    if (nextTransport !== previousTransport) {
      this.callbacks.onClientRegistered?.({ deviceName: current.name, deviceId, transport: nextTransport, firstConnect: false })
    }
  }

  private acquirePowerLock(): void {
    if (process.platform === 'darwin') {
      if (this.sleepBlockerProcess) return
      this.sleepBlockerProcess = spawn('caffeinate', ['-s', '-i'])
      this.sleepBlockerProcess.on('exit', () => { this.sleepBlockerProcess = null })
      log.info('[RemoteControl] caffeinate started')
    } else if (process.platform === 'linux') {
      if (this.sleepBlockerProcess) return
      this.sleepBlockerProcess = spawn('systemd-inhibit', [
        '--what=sleep', '--who=SuperOne', '--why=Remote control active', '--mode=block',
        'sleep', 'infinity',
      ])
      this.sleepBlockerProcess.on('exit', () => { this.sleepBlockerProcess = null })
      log.info('[RemoteControl] systemd-inhibit started')
    } else if (process.platform === 'win32') {
      if (this.powerBlockerId !== null) return
      this.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      log.info('[RemoteControl] powerSaveBlocker started:', this.powerBlockerId)
    }
  }

  private releasePowerLock(): void {
    if (this.sleepBlockerProcess) {
      this.sleepBlockerProcess.kill()
      this.sleepBlockerProcess = null
      log.info('[RemoteControl] sleep blocker process stopped')
    }
    if (this.powerBlockerId !== null) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = null
      log.info('[RemoteControl] powerSaveBlocker stopped')
    }
  }

  async start(config: RemoteDeviceConfig): Promise<void> {
    await this.stop()
    this.currentConfig = config
    this.relayUrl = config.relayUrl || this.defaultRelayUrl
    if (!config.enabled || !this.relayUrl) return

    this.keys = await deriveKeys(config.masterSecret)
    try {
      const hmacKey = await deriveFileTokenKeyFromExtractable(config.masterSecret)
      this.fileTokenSigner = createLanFileTokenSigner(hmacKey)
    } catch (err) {
      log.error('[RemoteControl] Failed to derive file token signer:', err)
      this.fileTokenSigner = null
    }
    this.intentionallyClosed = false
    await this.connectRelay()
    await this.startLanServer()
    if (config.preventSleep) this.acquirePowerLock()
    log.info('[RemoteControl] Started for device:', config.deviceId)
  }

  private async startLanServer(): Promise<void> {
    if (this.lanServer) return
    const server = new LanServer({
      getAesKey: () => this.keys?.aesKey ?? null,
      isPairedDevice: (id) => this.callbacks.isPairedDevice?.(id) ?? false,
      onCommand: (cmd, respond, source) => this.callbacks.onCommand(cmd, respond, { deviceId: source.deviceId, transport: 'lan' }),
      hostName: hostname(),
      onClientRegistered: ({ deviceName, deviceId }) => this.markDeviceOnline(deviceName, deviceId, 'lan'),
      onClientDisconnected: ({ deviceId }) => this.markDeviceOffline(deviceId, 'lan'),
      getFileTokenSigner: () => this.fileTokenSigner,
    })
    try {
      const { port } = await server.start()
      this.lanServer = server
      log.info(`[RemoteControl] LAN server listening on port ${port}`)
      await this.startLanAdvertiser(port)
    } catch (err) {
      log.error('[RemoteControl] Failed to start LAN server:', err)
    }
  }

  private async startLanAdvertiser(port: number): Promise<void> {
    if (!this.keys) return
    try {
      const roomId = await computeRoomId(this.keys.channelKeyHex)
      const advertiser = new LanAdvertiser()
      advertiser.publish({
        name: `superone-${roomId.substring(0, 8)}`,
        port,
        txt: { roomId, hostName: hostname() },
      })
      this.lanAdvertiser = advertiser
    } catch (err) {
      log.error('[RemoteControl] Failed to start LAN advertiser:', err)
    }
  }

  private buildHandshakeFrame(): string {
    const port = this.lanServer?.getPort()
    const hosts = port ? listLanIpAddresses() : []
    return JSON.stringify({
      type: 'handshake',
      hostName: hostname(),
      ...(port && hosts.length > 0 ? { lan: { hosts, port } } : {}),
    })
  }

  private async stopLanServer(): Promise<void> {
    this.lanAdvertiser?.unpublish()
    this.lanAdvertiser = null
    const server = this.lanServer
    this.lanServer = null
    if (!server) return
    for (const [id, info] of Array.from(this.connectedDevices)) {
      if (info.transports.has('lan')) this.markDeviceOffline(id, 'lan')
    }
    await server.stop()
    log.info('[RemoteControl] LAN server stopped')
  }

  isRelayConnected(): boolean {
    return this.relayWs !== null && this.relayWs.readyState === WebSocket.OPEN
  }

  async stop(): Promise<void> {
    await this.cancelPairing()
    this.intentionallyClosed = true
    this.sendQueue = Promise.resolve()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.relayWs) {
      this.relayWs.close(1000, 'stopping')
      this.relayWs = null
      this.callbacks.onRelayStatusChanged?.(false)
    }
    await this.stopLanServer()
    this.keys = null
    this.fileTokenSigner = null
    this.lanFrameSeq = 0
    this.releasePowerLock()
  }

  private async connectRelay(): Promise<void> {
    if (!this.keys || !this.relayUrl) return

    const ts = Date.now().toString()
    const token = await computeHmacToken(this.keys.channelKeyHex, 'desktop', ts)
    const room = await computeRoomId(this.keys.channelKeyHex)
    log.info('[RemoteControl] channelKeyHex:', this.keys.channelKeyHex.substring(0, 8) + '...')
    log.info('[RemoteControl] room:', room)
    const url = `${this.relayUrl}/ws?role=desktop&token=${token}&ts=${ts}&room=${room}`

    const ws = new WebSocket(url)
    this.relayWs = ws

    ws.on('open', () => {
      log.info('[RemoteControl] Relay connected')
      this.reconnectDelay = 1_000
      this.callbacks.onRelayStatusChanged?.(true)
      ws.send(this.buildHandshakeFrame())
    })

    ws.on('message', (raw) => {
      try {
        this.handleRelayMessage(JSON.parse(raw.toString()))
      } catch (err) {
        log.error('[RemoteControl] Failed to parse relay message:', err)
      }
    })

    ws.on('close', (code: number, reason: Buffer) => {
      log.info('[RemoteControl] Relay WS closed:', code, reason.toString())
      if (this.relayWs !== ws) return
      this.relayWs = null
      this.callbacks.onRelayStatusChanged?.(false)
      if (!this.intentionallyClosed) this.scheduleReconnect()
    })

    ws.on('error', (err) => {
      log.error('[RemoteControl] Relay WS error:', err.message)
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    log.info(`[RemoteControl] Reconnecting in ${this.reconnectDelay}ms`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      await this.connectRelay()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  private async handleRelayMessage(frame: { type: string; [key: string]: unknown }): Promise<void> {
    switch (frame.type) {
      case 'command': {
        if (!this.keys) return
        const command = (await decryptPayload(this.keys.aesKey, frame.data as string)) as RemoteCommand
        trace('remote.in', command.type, command)
        const deviceId = (frame.mobileDeviceId as string | undefined) ?? null
        if (!deviceId) {
          log.warn('[RemoteControl] relay command missing mobileDeviceId, dropping')
          return
        }
        this.callbacks.onCommand(command, (requestId, data) => this.sendResponse(requestId, data, deviceId), { deviceId, transport: 'relay' })
        break
      }
      case 'register': {
        const deviceName = (frame.deviceName as string) ?? 'Unknown Device'
        const deviceId = (frame.mobileDeviceId as string) ?? `unknown-${Date.now()}`
        if (this.callbacks.isPairedDevice && !this.callbacks.isPairedDevice(deviceId)) {
          log.warn('[RemoteControl] Rejecting unrecognized device:', deviceId)
          this.relayWs?.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
          this.lanServer?.kickDevice(deviceId)
          return
        }
        log.info('[CONN-DESK] register received deviceId=%s name=%s', deviceId, deviceName)
        this.markDeviceOnline(deviceName, deviceId, 'relay')
        break
      }
      case 'peer_connected':
        log.info('[CONN-DESK] peer_connected mobileDeviceId=%s, sending handshake', frame.mobileDeviceId ?? '(unknown)')
        this.relayWs?.send(this.buildHandshakeFrame())
        break
      case 'peer_disconnected': {
        const deviceId = frame.mobileDeviceId as string | undefined
        if (deviceId) {
          log.info('[RemoteControl] Mobile peer disconnected: %s', deviceId)
          this.markDeviceOffline(deviceId, 'relay')
        } else {
          log.info('[RemoteControl] Mobile peer disconnected (no deviceId)')
          for (const [id, info] of Array.from(this.connectedDevices)) {
            if (info.transports.has('relay')) this.markDeviceOffline(id, 'relay')
          }
        }
        break
      }
    }
  }

  async startPairing(): Promise<{ channelId: string; tempKeyHex: string; relayUrl: string }> {
    if (!this.relayUrl) this.relayUrl = this.defaultRelayUrl
    if (!this.relayUrl) throw new Error('No relay URL configured')
    await this.cancelPairing()

    const channelIdBytes = webcrypto.getRandomValues(new Uint8Array(8))
    const channelId = bytesToHex(channelIdBytes.buffer)

    const tempKeyBytes = webcrypto.getRandomValues(new Uint8Array(32))
    const tempKeyHex = bytesToHex(tempKeyBytes.buffer)
    const aesKey = await importRawAesKey(tempKeyHex)

    const expiryTimer = setTimeout(async () => {
      log.info('[RemoteControl] Pairing session expired:', channelId)
      await this.cancelPairing()
      this.callbacks.onPairingExpired?.()
    }, PAIRING_TIMEOUT_MS)

    const pairingUrl = `${this.relayUrl}/pair?channel=${channelId}&role=desktop`
    const ws = new WebSocket(pairingUrl)

    this.pairingSession = {
      channelId, aesKey, ws,
      pendingCode: null, pendingMobileDeviceId: null, pendingDeviceName: null,
      expiryTimer,
    }

    ws.on('message', async (raw) => {
      if (!this.pairingSession || this.pairingSession.pendingCode !== null) return
      try {
        const frame = JSON.parse(raw.toString())
        if (frame.type === 'pair_request') {
          const { code, mobileDeviceId, deviceName } = (await decryptPayload(aesKey, frame.data)) as {
            code: string; mobileDeviceId: string; deviceName: string
          }
          const name = deviceName ?? 'Mobile Device'
          if (this.callbacks.isPairedDevice?.(mobileDeviceId)) {
            log.info('[RemoteControl] Device already paired:', mobileDeviceId)
            ws.send(JSON.stringify({ type: 'pair_already_paired' }))
            this.callbacks.onPairingAlreadyPaired?.({ deviceName: name })
            await this.cancelPairing()
            return
          }
          this.pairingSession.pendingCode = code
          this.pairingSession.pendingMobileDeviceId = mobileDeviceId
          this.pairingSession.pendingDeviceName = name
          log.info('[RemoteControl] Pairing code received from:', name)
          this.callbacks.onPairingCodeReceived?.({ code, deviceName: name })
        }
      } catch (err) {
        log.error('[RemoteControl] Failed to handle pair_request:', err)
      }
    })

    ws.on('error', (err) => {
      log.error('[RemoteControl] Pairing WS error:', err.message)
    })

    log.info('[RemoteControl] Pairing session started:', channelId)
    return { channelId, tempKeyHex, relayUrl: this.relayUrl }
  }

  async confirmPairing(enteredCode: string, masterSecret: string): Promise<void> {
    const session = this.pairingSession
    if (!session || session.pendingCode === null) throw new Error('No pairing request received yet')
    if (session.pendingCode !== enteredCode) throw new Error('Incorrect pairing code')

    const encrypted = await encryptPayload(session.aesKey, {
      masterSecret,
      hostName: hostname(),
      relayUrl: this.relayUrl,
    })
    session.ws?.send(JSON.stringify({ type: 'pair_response', data: encrypted }))

    const mobileDeviceId = session.pendingMobileDeviceId!
    const deviceName = session.pendingDeviceName!
    log.info('[RemoteControl] Pairing confirmed for:', deviceName)
    this.callbacks.onPairingConfirmed?.({ mobileDeviceId, deviceName })
    await this.cancelPairing()
  }

  async cancelPairing(): Promise<void> {
    if (!this.pairingSession) return
    clearTimeout(this.pairingSession.expiryTimer)
    this.pairingSession.ws?.close(1000, 'cancelled')
    this.pairingSession = null
  }

  async sendEventToMobile(event: Record<string, unknown>, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return
    try {
      const data = await encryptPayload(this.keys.aesKey, event)
      this.sendEventFrame(data, targetDeviceIds)
    } catch (err) {
      log.error('[RemoteControl] Failed to send event to mobile:', err)
    }
  }

  private hasAnyMobileTransport(): boolean {
    const relayOpen = this.relayWs !== null && this.relayWs.readyState === WebSocket.OPEN
    const lanActive = this.lanServer !== null && !this.lanServer.isEmpty()
    return relayOpen || lanActive
  }

  private sendEventFrame(encryptedData: string, targetDeviceIds?: string[]): void {
    const basePayload: Record<string, unknown> = { type: 'event', data: encryptedData }
    if (targetDeviceIds && targetDeviceIds.length > 0) basePayload.targets = targetDeviceIds
    if (this.relayWs?.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify(basePayload))
    }
    if (this.lanServer) {
      const lanFrame = JSON.stringify({ ...basePayload, seq: ++this.lanFrameSeq })
      this.lanServer.broadcastFrame(lanFrame, targetDeviceIds)
    }
  }

  async sendAgentEvent(event: AgentEvent, targetDeviceIds?: string[]): Promise<void> {
    if (!this.keys) return
    if (!this.hasAnyMobileTransport()) return

    if (event.type === 'provider_changed') {
      trace('remote.out', event.type, event)
      this.queueSend([event], targetDeviceIds)
      return
    }
    trace('remote.debug', 'sendAgentEvent:pass', { eventType: event.type, eventProject: event.projectPath, eventSession: event.sessionId, targets: targetDeviceIds })

    if (event.type === 'tool_input_delta' && 'toolUseId' in event) {
      const entry = this.todoToolInputs.get(event.toolUseId as string)
      if (entry) entry.input += (event as { partialJson: string }).partialJson
    }

    if (SKIPPED_EVENTS.has(event.type)) return

    if (THROTTLED_EVENTS.has(event.type)) {
      const now = Date.now()
      const last = this.lastThrottledAt.get(event.type) ?? 0
      if (now - last < THROTTLE_INTERVAL_MS) return
      this.lastThrottledAt.set(event.type, now)
    }

    if (event.type === 'message_start') {
      this.bashToolCommands.clear()
      this.todoToolInputs.clear()
      this.widgetToolIds.clear()
      this.agentToolIds.clear()
      this.agentOutputFiles.clear()
      this.drainPending(true)
    }

    if (event.type === 'content_delta') {
      if (event.delta.type === 'text') {
        const parentId = event.delta.parentToolUseId ?? null
        const msgId = event.messageId
        if (this.pendingText && (this.pendingText.messageId !== msgId || this.pendingText.parentToolUseId !== parentId)) {
          this.flushPendingText(true)
        }
        if (this.pendingThinking) this.flushPendingThinking()
        if (!this.pendingText) this.pendingText = { messageId: msgId, text: '', parentToolUseId: parentId, targets: targetDeviceIds }
        this.pendingText.text += event.delta.text
        const pending = this.pendingText.text
        const newLen = pending.length - this.pendingTextFlushedLen
        if (newLen > 0 && (pending.lastIndexOf('\n\n') > this.pendingTextFlushedLen || newLen >= 1000)) {
          this.flushPendingText()
        }
        return
      }
      if (event.delta.type === 'thinking') {
        const parentId = event.delta.parentToolUseId ?? null
        const msgId = event.messageId
        if (this.pendingThinking && (this.pendingThinking.messageId !== msgId || this.pendingThinking.parentToolUseId !== parentId)) {
          this.flushPendingThinking()
        }
        if (this.pendingText) this.flushPendingText(true)
        if (!this.pendingThinking) this.pendingThinking = { messageId: msgId, text: '', parentToolUseId: parentId, targets: targetDeviceIds }
        this.pendingThinking.text += event.delta.thinking
        const pending = this.pendingThinking.text
        const breakIdx = pending.lastIndexOf('\n\n')
        if (breakIdx > 0) {
          this.pendingThinking.text = pending.slice(breakIdx + 2)
          const flushed = pending.slice(0, breakIdx)
          if (flushed.trim()) {
            const delta = { type: 'thinking' as const, thinking: flushed, parentToolUseId: parentId }
            const ev = { type: 'content_delta' as const, messageId: msgId, delta } as unknown as AgentEvent
            trace('remote.out', ev.type, ev, msgId)
            this.queueSend([ev], targetDeviceIds)
          }
        } else if (pending.length >= 1000) {
          this.flushPendingThinking()
        }
        return
      }
      this.drainPending(true)
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Bash') {
        try { const p = JSON.parse(event.delta.input); this.bashToolCommands.set(event.delta.toolUseId, String(p.command ?? '')) } catch {}
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName.endsWith('__show_widget')) {
        this.widgetToolIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && event.delta.toolName === 'Agent') {
        this.agentToolIds.add(event.delta.toolUseId)
      }
      if (event.delta.type === 'tool_use' && TODO_TOOLS.has(event.delta.toolName)) {
        this.todoToolInputs.set(event.delta.toolUseId, { toolName: event.delta.toolName, input: event.delta.input })
        return
      }
      let stripped: AgentEvent
      if (event.delta.type === 'tool_result' && this.todoToolInputs.has(event.delta.toolUseId)) {
        const entry = this.todoToolInputs.get(event.delta.toolUseId)!
        const toolTodos = computeTodoItems(entry.toolName, entry.input)
        stripped = { ...event, delta: { type: 'todo_result', toolUseId: event.delta.toolUseId, summary: event.delta.summary, parentToolUseId: event.delta.parentToolUseId, todoToolName: entry.toolName, toolTodos } }
      } else if (event.delta.type === 'tool_result' && this.widgetToolIds.has(event.delta.toolUseId)) {
        stripped = { ...event, delta: event.delta }
      } else if (event.delta.type === 'tool_result' && this.bashToolCommands.has(event.delta.toolUseId)) {
        const cmd = this.bashToolCommands.get(event.delta.toolUseId) ?? ''
        const raw = cmd ? `\x1b[32m$\x1b[0m ${cmd}\n${event.delta.summary}` : event.delta.summary
        const output = truncateBashOutput(raw)
        stripped = { ...event, delta: { type: 'bash_result', toolUseId: event.delta.toolUseId, summary: output, parentToolUseId: event.delta.parentToolUseId, outputTokens: parseAnsiTokens(output) } }
      } else if (event.delta.type === 'tool_result' && this.agentToolIds.has(event.delta.toolUseId)) {
        const outputMatch = event.delta.summary?.match(/output_file:\s*(\S+)/)
        if (outputMatch) this.agentOutputFiles.set(event.delta.toolUseId, outputMatch[1])
        stripped = { ...event, delta: event.delta }
      } else {
        stripped = stripEventForRemote(event, event.projectPath)
      }
      trace('remote.out', stripped.type, stripped, (stripped as Record<string, unknown>).messageId as string ?? '')
      this.queueSend([stripped], targetDeviceIds)
      return
    }

    if (DRAIN_BEFORE_EVENTS.has(event.type)) this.drainPending(true)
    let enriched = event
    if (event.type === 'task_progress' && event.toolUseId) {
      const outputFile = this.agentOutputFiles.get(event.toolUseId)
      if (outputFile) {
        const { resultText: activityText, toolEntries } = readOutputFile(outputFile, event.projectPath)
        enriched = { ...event, ...(activityText ? { activityText } : {}), ...(toolEntries.length > 0 ? { toolEntries } : {}) }
      }
    }
    if ((enriched.type === 'task_progress' || enriched.type === 'task_started') && enriched.description && event.projectPath) {
      enriched = { ...enriched, description: stripProjectPath(enriched.description, event.projectPath) }
    }
    const stripped = stripEventForRemote(enriched, event.projectPath)
    trace('remote.out', stripped.type, stripped, (stripped as Record<string, unknown>).messageId as string ?? '')
    this.queueSend([stripped], targetDeviceIds)
  }

  private async sendResponse(requestId: string, data: unknown, mobileDeviceId?: string): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
    try {
      trace('remote.resp', requestId, data)
      const encrypted = await encryptPayload(this.keys.aesKey, data)
      if (encrypted.length <= WS_CHUNK_SIZE) {
        this.relayWs.send(JSON.stringify({ type: 'response', requestId, data: encrypted, ...(mobileDeviceId ? { mobileDeviceId } : {}) }))
      } else {
        const totalChunks = Math.ceil(encrypted.length / WS_CHUNK_SIZE)
        log.info(`[RemoteControl] Chunking response ${requestId}: ${encrypted.length} bytes → ${totalChunks} chunks`)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = encrypted.slice(i * WS_CHUNK_SIZE, (i + 1) * WS_CHUNK_SIZE)
          this.relayWs.send(JSON.stringify({ type: 'response_chunk', requestId, index: i, total: totalChunks, data: chunk, ...(mobileDeviceId ? { mobileDeviceId } : {}) }))
        }
      }
    } catch (err) {
      log.error('[RemoteControl] Failed to send response:', err)
    }
  }

  private collectPendingThinking(): { events: AgentEvent[]; targets?: string[] } {
    if (!this.pendingThinking || !this.pendingThinking.text.trim()) {
      this.pendingThinking = null
      return { events: [] }
    }
    const { messageId, text, parentToolUseId, targets } = this.pendingThinking
    this.pendingThinking = null
    const delta = { type: 'thinking' as const, thinking: text, parentToolUseId }
    const event = { type: 'content_delta' as const, messageId, delta } as unknown as AgentEvent
    trace('remote.out', event.type, event, messageId)
    return { events: [event], targets }
  }

  private collectPendingText(final = false): { events: AgentEvent[]; targets?: string[] } {
    if (!this.pendingText || !this.pendingText.text.trim()) {
      this.pendingText = null
      this.pendingTextFlushedLen = 0
      return { events: [] }
    }
    const { messageId, text, parentToolUseId, targets } = this.pendingText
    const { segments, remainder } = splitTextIntoBlocks(text, !final)
    if (remainder) {
      this.pendingText = { messageId, text: remainder, parentToolUseId, targets }
      this.pendingTextFlushedLen = remainder.length
    } else {
      this.pendingText = null
      this.pendingTextFlushedLen = 0
    }
    const events: AgentEvent[] = []
    for (const seg of segments) {
      const delta = seg.type === 'insight'
        ? { type: 'insight' as const, title: seg.title!, content: seg.content!, parentToolUseId, codeBlockTokens: extractCodeBlockTokens(seg.content!) }
        : { type: 'text' as const, text: seg.text, parentToolUseId, codeBlockTokens: extractCodeBlockTokens(seg.text) }
      const event = { type: 'content_delta' as const, messageId, delta } as unknown as AgentEvent
      trace('remote.out', event.type, event, messageId)
      events.push(event)
    }
    return { events, targets }
  }

  private flushPendingText(final = false): void {
    const r = this.collectPendingText(final)
    if (r.events.length > 0) this.queueSend(r.events, r.targets)
  }

  private flushPendingThinking(): void {
    const r = this.collectPendingThinking()
    if (r.events.length > 0) this.queueSend(r.events, r.targets)
  }

  private drainPending(final = false): void {
    this.flushPendingText(final)
    this.flushPendingThinking()
  }

  private queueSend(events: AgentEvent[], targetDeviceIds?: string[]): void {
    if (events.length === 0) return
    this.sendQueue = this.sendQueue.then(async () => {
      if (!this.keys) return
      if (!this.hasAnyMobileTransport()) return
      const data = await encryptPayload(this.keys.aesKey, events)
      this.sendEventFrame(data, targetDeviceIds)
    }).catch(err => log.error('[RemoteControl] Failed to send events:', err))
  }
}
