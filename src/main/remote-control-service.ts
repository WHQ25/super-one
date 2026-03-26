import { webcrypto } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { powerSaveBlocker } from 'electron'
import WebSocket from 'ws'
import { diffLines } from 'diff'
import log from './logger'
import type { AgentEvent, RemoteCommand, ContentBlock, ChatMessage } from '../shared/agent-types'
import { trace } from './agent/event-trace'
import { readOutputFile } from './agent/claude-session-runtime'
import { initHighlighter, highlightCodeSync, highlightCodeByLang, parseAnsiTokens, type DiffTokenLine } from './remote-highlighter'

const subtle = webcrypto.subtle
const encoder = new TextEncoder()

const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const MAX_RECONNECT_DELAY_MS = 30_000
const SKIPPED_EVENTS = new Set([
  'files_persisted', 'elicitation_complete', 'tool_input_delta',
  'subagent_usage', 'checkpoint_captured', 'hook_started', 'hook_complete', 'hook_progress',
  'slash_command_output', 'stream_message_start', 'stream_message_stop',
])
const THROTTLED_EVENTS = new Set(['tool_progress'])

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

function computeTodoItems(toolName: string, input: string): Array<{ content: string; status: string; taskId?: string }> | undefined {
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

function countLines(s: string): number {
  if (!s) return 0
  return s.split('\n').length
}

function stripProjectPath(value: string, projectPath?: string): string {
  if (!projectPath) return value
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/'
  return value.includes(prefix) ? value.replaceAll(prefix, '') : value
}

function computeToolMeta(block: ContentBlock & { type: 'tool_use' }, projectPath?: string): { toolSummary?: string; toolFilePath?: string; toolLineDelta?: { added: number; removed: number }; toolDiff?: string; toolDiffTokens?: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }; toolTodos?: Array<{ content: string; status: string; taskId?: string }>; subagentType?: string; toolPrompt?: string; runInBackground?: boolean } {
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
          toolLineDelta = { added: countLines(newStr), removed: countLines(oldStr) }
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
      case 'ToolSearch':
        summary = String(p.query ?? '')
        break
    }
    return { toolSummary: summary, toolFilePath: filePath || undefined, toolLineDelta, toolDiff, toolDiffTokens, toolTodos }
  } catch { return {} }
}

function truncateBashOutput(text: string): string {
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
      const addedTokens = newStr && filePath ? highlightCodeSync(newStr, filePath) : undefined
      const removedTokens = oldStr && filePath ? highlightCodeSync(oldStr, filePath) : undefined
      const toolDiffTokens = (addedTokens || removedTokens) ? { added: addedTokens ?? undefined, removed: removedTokens ?? undefined } : undefined
      return { ...event, request: { ...event.request, toolDiff, toolDiffTokens } }
    }
    if (toolName === 'Write') {
      const content = String(input.content ?? '')
      if (!content) return event
      const toolDiff = content.split('\n').map((l: string) => `+${l}`).join('\n')
      const addedTokens = filePath ? highlightCodeSync(content, filePath) : undefined
      const toolDiffTokens = addedTokens ? { added: addedTokens } : undefined
      return { ...event, request: { ...event.request, toolDiff, toolDiffTokens } }
    }
  } catch { /* ignore highlight errors */ }
  return event
}

function stripEventForRemote(event: AgentEvent, projectPath?: string): AgentEvent {
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

export function stripMessagesForRemote(messages: ChatMessage[], projectPath?: string): ChatMessage[] {
  return messages.map((msg) => {
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
      metadata: msg.metadata ? (() => { const { codex: _c, ...rest } = msg.metadata!; return rest })() : undefined,
    }
  })
}

const THROTTLE_INTERVAL_MS = 2_000

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const arr = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16))
  return new Uint8Array(arr) as Uint8Array<ArrayBuffer>
}

async function importKeyMaterial(masterSecretHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(masterSecretHex), 'HKDF', false, ['deriveBits'])
}

async function deriveKeys(masterSecretHex: string): Promise<{
  channelKeyHex: string
  aesKey: webcrypto.CryptoKey
}> {
  const keyMaterial = await importKeyMaterial(masterSecretHex)
  const channelBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('channel-key') },
    keyMaterial,
    256,
  )
  const channelKeyHex = bytesToHex(channelBits)

  const aesBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('aes-key') },
    await importKeyMaterial(masterSecretHex),
    256,
  )
  const aesKey = await subtle.importKey('raw', aesBits, 'AES-GCM', false, ['encrypt', 'decrypt'])

  return { channelKeyHex, aesKey }
}

async function importRawAesKey(keyHex: string): Promise<webcrypto.CryptoKey> {
  return subtle.importKey('raw', hexToBytes(keyHex), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptPayload(aesKey: webcrypto.CryptoKey, payload: unknown): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(JSON.stringify(payload)))
  const result = new Uint8Array(12 + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), 12)
  return Buffer.from(result).toString('base64')
}

async function decryptPayload(aesKey: webcrypto.CryptoKey, data: string): Promise<unknown> {
  const bytes = Buffer.from(data, 'base64')
  const iv = bytes.subarray(0, 12)
  const ciphertext = bytes.subarray(12)
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

async function computeHmacToken(channelKeyHex: string, role: string, timestamp: string): Promise<string> {
  const key = await subtle.importKey('raw', hexToBytes(channelKeyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await subtle.sign('HMAC', key, encoder.encode(`${role}:${timestamp}`))
  return bytesToHex(sig)
}

async function computeRoomId(channelKeyHex: string): Promise<string> {
  const hash = await subtle.digest('SHA-256', hexToBytes(channelKeyHex))
  return bytesToHex(hash).substring(0, 32)
}

export interface RemoteDeviceConfig {
  enabled: boolean
  masterSecret: string
  deviceId: string
  preventSleep: boolean
  relayUrl: string
}

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

export interface RemoteControlCallbacks {
  onCommand: (cmd: RemoteCommand, respond: RemoteResponder) => void
  onClientRegistered?: (info: { deviceName: string; deviceId: string }) => void
  onClientDisconnected?: (info: { deviceId: string }) => void
  onSessionUnsubscribed?: (session: { projectPath: string; sessionId: string }) => void
  onRemoteFilterCleared?: (filter: { projectPath: string; sessionId: string }) => void
  onPairingCodeReceived?: (info: { code: string; deviceName: string }) => void
  onPairingExpired?: () => void
  onPairingConfirmed?: (info: { mobileDeviceId: string; deviceName: string }) => void
  onPairingAlreadyPaired?: (info: { deviceName: string }) => void
  isPairedDevice?: (deviceId: string) => boolean
}

export class RemoteControlService {
  private relayWs: WebSocket | null = null
  private keys: { channelKeyHex: string; aesKey: webcrypto.CryptoKey } | null = null
  private onlineDeviceIds = new Set<string>()
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
  private pendingText: { messageId: string; text: string; parentToolUseId: string | null } | null = null
  private pendingTextFlushedLen = 0
  private pendingThinking: { messageId: string; text: string; parentToolUseId: string | null } | null = null
  private subscribedSession: { projectPath: string; sessionId: string } | null = null
  private remoteSessionFilter: { projectPath: string; sessionId: string } | null = null

  private relayUrl = ''

  constructor(
    private readonly defaultRelayUrl: string,
    private readonly callbacks: RemoteControlCallbacks,
  ) {
    initHighlighter()
  }

  resume(): void {
    if (this.currentConfig) this.start(this.currentConfig)
  }

  getOnlineDeviceIds(): Set<string> {
    return this.onlineDeviceIds
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
    this.intentionallyClosed = false
    await this.connectRelay()
    if (config.preventSleep) this.acquirePowerLock()
    log.info('[RemoteControl] Started for device:', config.deviceId)
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
    }
    this.keys = null
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
      ws.send(JSON.stringify({ type: 'handshake', hostName: hostname() }))
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
        this.callbacks.onCommand(command, (requestId, data) => this.sendResponse(requestId, data))
        break
      }
      case 'register': {
        const deviceName = (frame.deviceName as string) ?? 'Unknown Device'
        const deviceId = (frame.mobileDeviceId as string) ?? `unknown-${Date.now()}`
        if (this.callbacks.isPairedDevice && !this.callbacks.isPairedDevice(deviceId)) {
          log.warn('[RemoteControl] Rejecting unrecognized device:', deviceId)
          this.relayWs?.send(JSON.stringify({ type: 'kicked', mobileDeviceId: deviceId }))
          return
        }
        log.info('[RemoteControl] Client registered:', deviceName, deviceId)
        this.onlineDeviceIds.add(deviceId)
        this.callbacks.onClientRegistered?.({ deviceName, deviceId })
        break
      }
      case 'peer_connected':
        log.info('[RemoteControl] Mobile peer connected')
        this.relayWs?.send(JSON.stringify({ type: 'handshake', hostName: hostname() }))
        break
      case 'peer_disconnected': {
        log.info('[RemoteControl] Mobile peer disconnected')
        if (this.subscribedSession) {
          this.callbacks.onSessionUnsubscribed?.(this.subscribedSession)
          this.subscribedSession = null
        }
        if (this.remoteSessionFilter) {
          const filter = this.remoteSessionFilter
          this.remoteSessionFilter = null
          this.callbacks.onRemoteFilterCleared?.(filter)
        }
        for (const id of this.onlineDeviceIds) {
          this.onlineDeviceIds.delete(id)
          this.callbacks.onClientDisconnected?.({ deviceId: id })
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

  getSubscribedSession(): { projectPath: string; sessionId: string } | null {
    return this.subscribedSession
  }

  subscribeSession(projectPath: string, sessionId: string, broadcastToRenderer?: (event: AgentEvent) => void): void {
    this.subscribedSession = { projectPath, sessionId }
    broadcastToRenderer?.({ type: 'remote_session_start', remoteProjectPath: projectPath, remoteSessionId: sessionId, isSubscribe: true })
    log.info(`[RemoteControl] Subscribed to session: ${sessionId} in ${projectPath}`)
  }

  unsubscribeSession(broadcastToRenderer?: (event: AgentEvent) => void): void {
    if (this.subscribedSession) {
      broadcastToRenderer?.({ type: 'remote_session_end', remoteProjectPath: this.subscribedSession.projectPath, remoteSessionId: this.subscribedSession.sessionId })
    }
    this.subscribedSession = null
    log.info('[RemoteControl] Unsubscribed from session')
  }

  setRemoteSessionFilter(projectPath: string, sessionId: string): void {
    this.remoteSessionFilter = { projectPath, sessionId }
    log.info(`[RemoteControl] Remote session filter set: ${sessionId} in ${projectPath}`)
  }

  clearRemoteSessionFilter(): void {
    this.remoteSessionFilter = null
    log.info('[RemoteControl] Remote session filter cleared')
  }

  async sendEventToMobile(event: Record<string, unknown>): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
    try {
      const data = await encryptPayload(this.keys.aesKey, event)
      this.relayWs.send(JSON.stringify({ type: 'event', data }))
    } catch (err) {
      log.error('[RemoteControl] Failed to send event to mobile:', err)
    }
  }

  async broadcastAgentEvent(event: AgentEvent): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return

    const filter = this.subscribedSession ?? this.remoteSessionFilter
    if (filter) {
      const { projectPath, sessionId } = filter
      if (event.projectPath !== projectPath || (event.sessionId && event.sessionId !== sessionId)) {
        trace('remote.debug', 'broadcastAgentEvent:filtered', { eventType: event.type, eventProject: event.projectPath, eventSession: event.sessionId, filterProject: projectPath, filterSession: sessionId })
        return
      }
    }
    trace('remote.debug', 'broadcastAgentEvent:pass', { eventType: event.type, eventProject: event.projectPath, eventSession: event.sessionId, hasFilter: !!filter, filterType: this.subscribedSession ? 'subscribed' : this.remoteSessionFilter ? 'remoteFilter' : 'none' })

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
      this.queueSend(this.drainPending(true))
    }

    if (event.type === 'content_delta') {
      if (event.delta.type === 'text') {
        const parentId = event.delta.parentToolUseId ?? null
        const msgId = event.messageId
        if (this.pendingText && (this.pendingText.messageId !== msgId || this.pendingText.parentToolUseId !== parentId)) {
          this.queueSend(this.collectPendingText(true))
        }
        if (!this.pendingText) this.pendingText = { messageId: msgId, text: '', parentToolUseId: parentId }
        this.pendingText.text += event.delta.text
        const pending = this.pendingText.text
        const newLen = pending.length - this.pendingTextFlushedLen
        if (newLen > 0 && (pending.lastIndexOf('\n\n') > this.pendingTextFlushedLen || newLen >= 1000)) {
          this.queueSend(this.collectPendingText())
        }
        return
      }
      if (event.delta.type === 'thinking') {
        const parentId = event.delta.parentToolUseId ?? null
        const msgId = event.messageId
        if (this.pendingThinking && (this.pendingThinking.messageId !== msgId || this.pendingThinking.parentToolUseId !== parentId)) {
          this.queueSend(this.collectPendingThinking())
        }
        if (!this.pendingThinking) this.pendingThinking = { messageId: msgId, text: '', parentToolUseId: parentId }
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
            this.queueSend([ev])
          }
        } else if (pending.length >= 1000) {
          this.queueSend(this.collectPendingThinking())
        }
        return
      }
      const flushed = this.drainPending(true)
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
        this.queueSend(flushed)
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
      flushed.push(stripped)
      this.queueSend(flushed)
      return
    }

    const flushed = this.drainPending(true)
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
    flushed.push(stripped)
    this.queueSend(flushed)
  }

  private async sendResponse(requestId: string, data: unknown): Promise<void> {
    if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
    try {
      trace('remote.resp', requestId, data)
      const encrypted = await encryptPayload(this.keys.aesKey, data)
      if (encrypted.length <= WS_CHUNK_SIZE) {
        this.relayWs.send(JSON.stringify({ type: 'response', requestId, data: encrypted }))
      } else {
        const totalChunks = Math.ceil(encrypted.length / WS_CHUNK_SIZE)
        log.info(`[RemoteControl] Chunking response ${requestId}: ${encrypted.length} bytes → ${totalChunks} chunks`)
        for (let i = 0; i < totalChunks; i++) {
          const chunk = encrypted.slice(i * WS_CHUNK_SIZE, (i + 1) * WS_CHUNK_SIZE)
          this.relayWs.send(JSON.stringify({ type: 'response_chunk', requestId, index: i, total: totalChunks, data: chunk }))
        }
      }
    } catch (err) {
      log.error('[RemoteControl] Failed to send response:', err)
    }
  }

  private collectPendingThinking(): AgentEvent[] {
    if (!this.pendingThinking || !this.pendingThinking.text.trim()) {
      this.pendingThinking = null
      return []
    }
    const { messageId, text, parentToolUseId } = this.pendingThinking
    this.pendingThinking = null
    const delta = { type: 'thinking' as const, thinking: text, parentToolUseId }
    const event = { type: 'content_delta' as const, messageId, delta } as unknown as AgentEvent
    trace('remote.out', event.type, event, messageId)
    return [event]
  }

  private collectPendingText(final = false): AgentEvent[] {
    if (!this.pendingText || !this.pendingText.text.trim()) {
      this.pendingText = null
      this.pendingTextFlushedLen = 0
      return []
    }
    const { messageId, text, parentToolUseId } = this.pendingText
    const { segments, remainder } = splitTextIntoBlocks(text, !final)
    if (remainder) {
      this.pendingText = { messageId, text: remainder, parentToolUseId }
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
    return events
  }

  private drainPending(final = false): AgentEvent[] {
    return [...this.collectPendingText(final), ...this.collectPendingThinking()]
  }

  private queueSend(events: AgentEvent[]): void {
    if (events.length === 0) return
    this.sendQueue = this.sendQueue.then(async () => {
      if (!this.keys || !this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) return
      const data = await encryptPayload(this.keys.aesKey, events)
      this.relayWs.send(JSON.stringify({ type: 'event', data }))
    }).catch(err => log.error('[RemoteControl] Failed to send events:', err))
  }
}
