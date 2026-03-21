import { Database } from 'bun:sqlite'
import { diffLines } from 'diff'

const DB_PATH = process.argv[2] || 'event-trace.db'

const SKIPPED_EVENTS = new Set([
  'files_persisted', 'elicitation_complete', 'tool_input_delta',
  'subagent_usage', 'checkpoint_captured', 'hook_started', 'hook_complete', 'hook_progress',
  'slash_command_output', 'stream_message_start', 'stream_message_stop',
])

const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])
const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const TOOL_TYPE_MAP: Record<string, string> = {
  Read: 'read', Edit: 'edit', Write: 'write',
  NotebookEdit: 'notebook_edit', FileChange: 'file_change',
  Bash: 'bash', Grep: 'grep', Glob: 'glob',
  WebSearch: 'web_search', WebFetch: 'web_fetch',
  Agent: 'agent', Skill: 'skill',
}

const TOOL_RESULT_MAX_LEN = 200
const MAX_BASH_OUTPUT = 5000
const MAX_BASH_LINES = 100

function countLines(s: string): number {
  return s ? s.split('\n').length : 0
}

function truncateBashOutput(text: string): string {
  const lines = text.split('\n')
  const truncated = lines.length > MAX_BASH_LINES ? lines.slice(0, MAX_BASH_LINES).join('\n') + '\n…' : text
  return truncated.length > MAX_BASH_OUTPUT ? truncated.slice(0, MAX_BASH_OUTPUT) + '…' : truncated
}

function computeTodoItems(toolName: string, input: string) {
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
  } catch {}
  return undefined
}

function computeToolMeta(block: Record<string, unknown>) {
  try {
    const input = String(block.input ?? '')
    const toolName = String(block.toolName ?? '')
    const p = JSON.parse(input)
    if (!p || typeof p !== 'object') return {}
    const filePath = FILE_PATH_TOOLS.has(toolName) ? String(p.file_path ?? p.notebook_path ?? '') : undefined
    let summary: string | undefined
    let toolLineDelta: { added: number; removed: number } | undefined
    let toolDiff: string | undefined
    let toolTodos: Array<{ content: string; status: string; taskId?: string }> | undefined
    switch (toolName) {
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
        }
        break
      }
      case 'Write': {
        const content = String(p.content ?? '')
        if (content) {
          toolLineDelta = { added: countLines(content), removed: 0 }
          toolDiff = content.split('\n').map((l: string) => `+${l}`).join('\n')
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
        toolTodos = computeTodoItems(toolName, input)
        if (toolName === 'TodoWrite' && toolTodos) {
          const done = toolTodos.filter((t) => t.status === 'completed').length
          summary = `Todos (${done}/${toolTodos.length})`
        } else if (toolName === 'TaskCreate') {
          summary = String(p.subject ?? '')
        } else {
          summary = `${p.status ?? 'update'}: ${p.subject ?? p.taskId ?? ''}`
        }
        break
      case 'Agent':
      case 'Task':
        summary = String(p.description ?? p.name ?? '')
        return { toolSummary: summary, subagentType: p.subagent_type ? String(p.subagent_type) : undefined, toolPrompt: p.prompt ? String(p.prompt) : undefined }
      case 'ToolSearch':
        summary = String(p.query ?? '')
        break
    }
    return { toolSummary: summary, toolFilePath: filePath || undefined, toolLineDelta, toolDiff, toolTodos }
  } catch { return {} }
}

const INSIGHT_HEADER_RE = /^`★\s+(.+?)\s+─{3,}`$/m
const INSIGHT_FOOTER_RE = /^`─{3,}`$/

function splitTextIntoBlocks(text: string): Array<{ type: string; text?: string; title?: string; content?: string }> {
  if (!text.trim()) return []
  const lines = text.split('\n')
  const segments: Array<{ type: string; text?: string; title?: string; content?: string }> = []
  let current: string[] = []
  let inCodeFence = false
  let fenceTicks = ''
  let codeLines: string[] = []
  let codeLang = ''
  let inTable = false
  let tableLines: string[] = []
  let insightTitle: string | null = null
  let insightLines: string[] = []

  function flushCurrent() {
    const t = current.join('\n').trim()
    if (t) segments.push({ type: 'text', text: (segments.length > 0 ? '\n\n' : '') + t })
    current = []
  }

  function flushTable() {
    if (tableLines.length > 0) {
      segments.push({ type: 'text', text: (segments.length > 0 ? '\n\n' : '') + tableLines.join('\n') })
      tableLines = []
    }
    inTable = false
  }

  for (const line of lines) {
    if (insightTitle !== null) {
      if (INSIGHT_FOOTER_RE.test(line)) {
        segments.push({ type: 'insight', title: insightTitle, content: insightLines.join('\n') })
        insightTitle = null
        insightLines = []
      } else {
        insightLines.push(line)
      }
      continue
    }
    if (inCodeFence) {
      if (line.trimEnd() === fenceTicks) {
        segments.push({ type: 'text', text: (segments.length > 0 ? '\n\n' : '') + `${fenceTicks}${codeLang}\n${codeLines.join('\n')}\n${fenceTicks}` })
        inCodeFence = false
        fenceTicks = ''
        codeLines = []
        codeLang = ''
      } else {
        codeLines.push(line)
      }
      continue
    }
    const fenceMatch = line.match(/^(`{3,})(\w*)/)
    if (fenceMatch) {
      if (inTable) flushTable()
      flushCurrent()
      inCodeFence = true
      fenceTicks = fenceMatch[1]
      codeLang = fenceMatch[2] || ''
      codeLines = []
      continue
    }
    const insightMatch = line.match(INSIGHT_HEADER_RE)
    if (insightMatch) {
      if (inTable) flushTable()
      flushCurrent()
      insightTitle = insightMatch[1].trim()
      insightLines = []
      continue
    }
    if (line.startsWith('|') && line.includes('|', 1)) {
      if (!inTable) { flushCurrent(); inTable = true }
      tableLines.push(line)
      continue
    }
    if (inTable) flushTable()
    current.push(line)
  }
  if (insightTitle !== null) {
    current.push(`\`★ ${insightTitle} ${'─'.repeat(37)}\``)
    current.push(...insightLines)
  }
  if (inCodeFence) { current.push(`${fenceTicks}${codeLang}`); current.push(...codeLines) }
  if (inTable) flushTable()
  flushCurrent()
  return segments
}

function stripContentBlock(block: Record<string, unknown>, bashCmds?: Map<string, string>, agentIds?: Set<string>): Record<string, unknown> {
  if (block.type === 'text') return block
  if (block.type === 'thinking') return block
  if (block.type === 'tool_use') {
    const meta = computeToolMeta(block)
    const toolName = String(block.toolName ?? '')
    const mappedType = TOOL_TYPE_MAP[toolName] ?? 'tool_use'
    const keepInput = toolName.endsWith('__show_widget')
    return { ...block, type: mappedType, input: keepInput ? block.input : '', ...meta }
  }
  if (block.type === 'tool_result') {
    const toolUseId = String(block.toolUseId ?? '')
    if (bashCmds?.has(toolUseId)) {
      const cmd = bashCmds.get(toolUseId) ?? ''
      const raw = cmd ? `\x1b[32m$\x1b[0m ${cmd}\n${block.summary}` : String(block.summary ?? '')
      const output = truncateBashOutput(raw)
      return { type: 'bash_result', toolUseId, summary: output, parentToolUseId: block.parentToolUseId }
    }
    const summary = String(block.summary ?? '')
    if (!agentIds?.has(toolUseId) && summary.length > TOOL_RESULT_MAX_LEN) {
      return { ...block, summary: summary.slice(0, TOOL_RESULT_MAX_LEN) + '…' }
    }
  }
  return block
}

function stripEvent(event: Record<string, unknown>, bashCmds?: Map<string, string>, agentIds?: Set<string>): Record<string, unknown> {
  if (event.type === 'content_delta') {
    return { ...event, delta: stripContentBlock(event.delta as Record<string, unknown>, bashCmds, agentIds) }
  }
  if (event.type === 'message_start') {
    const msg = event.message as Record<string, unknown>
    const content = Array.isArray(msg.content) ? msg.content.map((b: Record<string, unknown>) => stripContentBlock(b, bashCmds, agentIds)) : []
    return { ...event, message: { ...msg, content } }
  }
  if (event.type === 'message_complete' && event.metadata) {
    const { codex: _, ...rest } = event.metadata as Record<string, unknown>
    return { ...event, metadata: rest }
  }
  return event
}

const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')

db.exec("DELETE FROM events WHERE source='remote.out'")

const rows = db.prepare("SELECT id, tag, data FROM events WHERE source='agent.emit' ORDER BY id").all() as Array<{ id: number; tag: string; data: string }>

const insert = db.prepare("INSERT INTO events (ts, source, type, tag, data) VALUES (?, 'remote.out', ?, ?, ?)")

const bashCmds = new Map<string, string>()
const todoInputs = new Map<string, { toolName: string; input: string }>()
const widgetToolIds = new Set<string>()
const agentToolIds = new Set<string>()
let pendingText: { messageId: string; tag: string; text: string; parentToolUseId: string | null; deltaType: string } | null = null
let pendingThinking: { messageId: string; tag: string; text: string; parentToolUseId: string | null } | null = null
let count = 0

function flushPendingText() {
  if (!pendingText || !pendingText.text.trim()) { pendingText = null; return }
  const { messageId, tag, text, parentToolUseId, deltaType } = pendingText
  pendingText = null
  if (deltaType === 'thinking') {
    const delta = { type: 'thinking', thinking: text, parentToolUseId }
    const stripped = { type: 'content_delta', messageId, delta }
    const ts = new Date().toISOString().slice(11, 23)
    insert.run(ts, 'content_delta', tag, JSON.stringify(stripped))
    count++
    return
  }
  for (const seg of splitTextIntoBlocks(text)) {
    const delta = seg.type === 'insight'
      ? { type: 'insight', title: seg.title, content: seg.content, parentToolUseId }
      : { type: 'text', text: seg.text, parentToolUseId }
    const stripped = { type: 'content_delta', messageId, delta }
    const ts = new Date().toISOString().slice(11, 23)
    insert.run(ts, 'content_delta', tag, JSON.stringify(stripped))
    count++
  }
}

function flushPendingThinking() {
  if (!pendingThinking || !pendingThinking.text.trim()) { pendingThinking = null; return }
  const { messageId, tag, text, parentToolUseId } = pendingThinking
  pendingThinking = null
  const delta = { type: 'thinking', thinking: text, parentToolUseId }
  const stripped = { type: 'content_delta', messageId, delta }
  const ts = new Date().toISOString().slice(11, 23)
  insert.run(ts, 'content_delta', tag, JSON.stringify(stripped))
  count++
}

for (const row of rows) {
  const event = JSON.parse(row.data) as Record<string, unknown>
  const eventType = String(event.type ?? '')

  if (eventType === 'tool_input_delta' && event.toolUseId) {
    const entry = todoInputs.get(String(event.toolUseId))
    if (entry) entry.input += String((event as Record<string, unknown>).partialJson ?? '')
    continue
  }

  if (SKIPPED_EVENTS.has(eventType)) continue

  if (eventType === 'message_start') {
    flushPendingText()
    flushPendingThinking()
    bashCmds.clear()
    todoInputs.clear()
    widgetToolIds.clear()
  }

  if (eventType === 'content_delta') {
    const delta = event.delta as Record<string, unknown>
    const deltaType = String(delta?.type ?? '')
    const toolName = String(delta?.toolName ?? '')

    if (deltaType === 'text') {
      const parentId = delta.parentToolUseId as string | null ?? null
      const msgId = String(event.messageId ?? '')
      if (pendingText && (pendingText.messageId !== msgId || pendingText.parentToolUseId !== parentId || pendingText.deltaType !== 'text')) {
        flushPendingText()
      }
      if (!pendingText) pendingText = { messageId: msgId, tag: row.tag, text: '', parentToolUseId: parentId, deltaType: 'text' }
      pendingText.text += String(delta.text ?? '')
      continue
    }

    if (deltaType === 'thinking') {
      flushPendingText()
      const parentId = delta.parentToolUseId as string | null ?? null
      const msgId = String(event.messageId ?? '')
      if (pendingThinking && (pendingThinking.messageId !== msgId || pendingThinking.parentToolUseId !== parentId)) {
        flushPendingThinking()
      }
      if (!pendingThinking) pendingThinking = { messageId: msgId, tag: row.tag, text: '', parentToolUseId: parentId }
      pendingThinking.text += String(delta.thinking ?? '')
      const pending = pendingThinking.text
      const breakIdx = pending.lastIndexOf('\n\n')
      if (breakIdx > 0) {
        pendingThinking.text = pending.slice(breakIdx + 2)
        const flushed = pending.slice(0, breakIdx)
        if (flushed.trim()) {
          const d = { type: 'thinking', thinking: flushed, parentToolUseId: parentId }
          const ts = new Date().toISOString().slice(11, 23)
          insert.run(ts, 'content_delta', row.tag, JSON.stringify({ type: 'content_delta', messageId: msgId, delta: d }))
          count++
        }
      } else if (pending.length >= 1000) {
        flushPendingThinking()
      }
      continue
    }

    flushPendingText()
    flushPendingThinking()

    if (deltaType === 'tool_use' && toolName === 'Bash') {
      try { const p = JSON.parse(String(delta.input ?? '{}')); bashCmds.set(String(delta.toolUseId), String(p.command ?? '')) } catch {}
    }

    if (deltaType === 'tool_use' && toolName.endsWith('__show_widget')) {
      widgetToolIds.add(String(delta.toolUseId))
    }
    if (deltaType === 'tool_use' && toolName === 'Agent') {
      agentToolIds.add(String(delta.toolUseId))
    }

    if (deltaType === 'tool_use' && TODO_TOOLS.has(toolName)) {
      todoInputs.set(String(delta.toolUseId), { toolName, input: String(delta.input ?? '') })
      continue
    }

    let stripped: Record<string, unknown>
    if (deltaType === 'tool_result' && todoInputs.has(String(delta.toolUseId))) {
      const entry = todoInputs.get(String(delta.toolUseId))!
      const toolTodos = computeTodoItems(entry.toolName, entry.input)
      stripped = { ...event, delta: { type: 'todo_result', toolUseId: delta.toolUseId, summary: delta.summary, parentToolUseId: delta.parentToolUseId, todoToolName: entry.toolName, toolTodos } }
    } else if (deltaType === 'tool_result' && widgetToolIds.has(String(delta.toolUseId))) {
      stripped = { ...event, delta }
    } else if (deltaType === 'tool_result' && bashCmds.has(String(delta.toolUseId))) {
      const cmd = bashCmds.get(String(delta.toolUseId)) ?? ''
      const raw = cmd ? `\x1b[32m$\x1b[0m ${cmd}\n${delta.summary}` : String(delta.summary ?? '')
      const output = truncateBashOutput(raw)
      stripped = { ...event, delta: { type: 'bash_result', toolUseId: delta.toolUseId, summary: output, parentToolUseId: delta.parentToolUseId } }
    } else if (deltaType === 'tool_result' && agentToolIds.has(String(delta.toolUseId))) {
      stripped = { ...event, delta }
    } else {
      stripped = stripEvent(event, bashCmds, agentToolIds)
    }

    const ts = new Date().toISOString().slice(11, 23)
    insert.run(ts, String(stripped.type), row.tag, JSON.stringify(stripped))
    count++
    continue
  }

  flushPendingText()
  flushPendingThinking()
  const stripped = stripEvent(event, bashCmds, agentToolIds)
  const ts = new Date().toISOString().slice(11, 23)
  insert.run(ts, String(stripped.type), row.tag, JSON.stringify(stripped))
  count++
}
flushPendingText()
flushPendingThinking()

console.log(`Converted ${rows.length} agent.emit events → ${count} remote.out events`)
console.log(`Skipped: ${rows.length - count} (tool_input_delta, todo tool_use, etc.)`)

db.close()
