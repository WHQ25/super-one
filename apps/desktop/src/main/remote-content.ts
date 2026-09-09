import { diffLines } from 'diff'
import { humanizePageToolName } from '@superone/shared/page-tool-name'
import type { AgentEvent, ContentBlock, ChatMessage, TodoToolItem } from '@superone/shared/agent-types'
import { isSubagentToolName } from '@superone/shared/tool-ui'
import { remoteToolBlockType, sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { readOutputFile } from './agent/claude-session-runtime'
import { listWorkflowAgentsSync } from './workflow-transcripts'
import { highlightCodeSync, highlightCodeByLang, parseAnsiTokens, type DiffTokenLine } from './remote-highlighter'

const TOOL_RESULT_MAX_LEN = 200
const MAX_BASH_OUTPUT = 5000
const MAX_BASH_LINES = 100

const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])
export const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])


interface WorkflowPhase {
  title: string
  detail?: string
}

function workflowQuotedValue(src: string, key: string): string | undefined {
  const m = src.match(new RegExp(`${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`))
  return m ? m[2] : undefined
}

function workflowPhasesFrom(metaSrc: string): WorkflowPhase[] {
  const keyIdx = metaSrc.indexOf('phases')
  if (keyIdx < 0) return []
  const start = metaSrc.indexOf('[', keyIdx)
  if (start < 0) return []
  let depth = 0
  let end = -1
  for (let i = start; i < metaSrc.length; i++) {
    const c = metaSrc[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) return []
  const arr = metaSrc.slice(start + 1, end)
  const phases: WorkflowPhase[] = []
  const objRe = /\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = objRe.exec(arr))) {
    const title = workflowQuotedValue(m[1], 'title')
    if (title) phases.push({ title, detail: workflowQuotedValue(m[1], 'detail') })
  }
  return phases
}

export function parseWorkflowMeta(script: string): { name: string; description: string; phases: WorkflowPhase[] } {
  const metaIdx = script.indexOf('meta')
  const metaSrc = metaIdx >= 0 ? script.slice(metaIdx) : script
  return {
    name: workflowQuotedValue(metaSrc, 'name') ?? '',
    description: workflowQuotedValue(metaSrc, 'description') ?? '',
    phases: workflowPhasesFrom(metaSrc),
  }
}

export function parseWorkflowTranscriptDir(summary?: string): string | undefined {
  if (!summary) return undefined
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>
      if (o && typeof o.transcriptDir === 'string') return o.transcriptDir
    } catch { /* fall through */ }
  }
  return summary.match(/Transcript dir:\s*(\S+)/)?.[1]
}

function optStr(v: unknown): string | undefined {
  return v ? String(v) : undefined
}

function optStrArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.length > 0 ? v.map(String) : undefined
}

export function computeTodoItems(toolName: string, input: string): TodoToolItem[] | undefined {
  try {
    const p = JSON.parse(input)
    if (!p || typeof p !== 'object') return undefined
    if (toolName === 'TodoWrite') {
      const todos = Array.isArray(p.todos) ? p.todos : []
      return todos.map((t: Record<string, unknown>, i: number) => ({
        content: String(t.content ?? t.subject ?? ''),
        status: String(t.status ?? 'pending'),
        taskId: String(i + 1),
        description: optStr(t.description),
        activeForm: optStr(t.activeForm),
      }))
    }
    if (toolName === 'TaskCreate') {
      return [{
        content: String(p.subject ?? ''),
        status: 'pending',
        subject: optStr(p.subject),
        description: optStr(p.description),
        activeForm: optStr(p.activeForm),
      }]
    }
    if (toolName === 'TaskUpdate') {
      return [{
        content: String(p.subject ?? ''),
        status: String(p.status ?? 'pending'),
        taskId: String(p.taskId ?? ''),
        subject: optStr(p.subject),
        description: optStr(p.description),
        activeForm: optStr(p.activeForm),
        owner: optStr(p.owner),
        addBlockedBy: optStrArray(p.addBlockedBy),
        addBlocks: optStrArray(p.addBlocks),
      }]
    }
  } catch { /* ignore */ }
  return undefined
}

/**
 * TaskCreate's real task id only arrives on the result (extractTaskCreateTodo
 * surfaces it via toolTodos). Mirror the desktop store: keep the rich
 * input-derived fields from computeTodoItems and overlay the resolved id so
 * mobile keys the todo the same way a later TaskUpdate references it.
 */
export function resolveTodoToolTodos(
  toolName: string,
  input: string,
  resultToolTodos: TodoToolItem[] | undefined,
): TodoToolItem[] | undefined {
  const computed = computeTodoItems(toolName, input)
  if (toolName !== 'TaskCreate') return computed
  const resolvedId = resultToolTodos?.[0]?.taskId
  if (!resolvedId) return computed ?? resultToolTodos
  if (computed?.length) return [{ ...computed[0], taskId: resolvedId }]
  return resultToolTodos
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

export function computeToolMeta(block: ContentBlock & { type: 'tool_use' }, projectPath?: string): { toolSummary?: string; toolFilePath?: string; toolLineDelta?: { added: number; removed: number }; toolDiff?: string; toolDiffTokens?: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }; toolTodos?: TodoToolItem[]; subagentType?: string; toolPrompt?: string; runInBackground?: boolean; workflowName?: string; workflowDescription?: string; workflowPhases?: WorkflowPhase[] } {
  try {
    const p = JSON.parse(block.input)
    if (!p || typeof p !== 'object') return {}
    const rawFilePath = FILE_PATH_TOOLS.has(block.toolName) ? String(p.file_path ?? p.notebook_path ?? '') : undefined
    const filePath = rawFilePath ? stripProjectPath(rawFilePath, projectPath) : undefined
    let summary: string | undefined
    let toolLineDelta: { added: number; removed: number } | undefined
    let toolDiff: string | undefined
    let toolDiffTokens: { added?: DiffTokenLine[]; removed?: DiffTokenLine[] } | undefined
    let toolTodos: TodoToolItem[] | undefined
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
      case 'LS': {
        // The desktop row shortens this against the open checkout. A remote surface has no
        // checkout, so without a summary computed here its row prints the absolute path.
        const dir = String(p.path ?? p.target_directory ?? p.directory ?? '')
        summary = dir ? stripProjectPath(dir, projectPath) : ''
        break
      }
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
      case 'Workflow': {
        const wfMeta = parseWorkflowMeta(typeof p.script === 'string' ? p.script : '')
        const wfName = wfMeta.name || (typeof p.name === 'string' ? p.name : '')
        return { toolSummary: wfMeta.description, workflowName: wfName || undefined, workflowDescription: wfMeta.description || undefined, workflowPhases: wfMeta.phases.length > 0 ? wfMeta.phases : undefined }
      }
      case 'AskUserQuestion': {
        const questions = Array.isArray(p.questions) ? p.questions : []
        summary = `${questions.length} question${questions.length !== 1 ? 's' : ''}`
        break
      }
      case 'ToolSearch':
      case 'SearchTools':
        summary = String(p.query ?? '')
        break
    }
    if (!summary && block.toolName.endsWith('__browser_tools_call')) {
      // The agent's own `description` reads like a sentence; the page-tool name is the fallback,
      // humanized with the same helper the desktop row uses so both surfaces name one call alike.
      const written = typeof p.description === 'string' ? p.description.trim() : ''
      const named = typeof p.name === 'string' ? humanizePageToolName(p.name) : ''
      summary = written || named || undefined
    }
    // The phone gets a privacy-projected input, so keep the agent-written description
    // as stable summary metadata as well.
    if (!summary && /__device_[a-z_]+$/.test(block.toolName)) {
      summary = typeof p.description === 'string' && p.description.trim()
        ? p.description.trim()
        : undefined
    }
    if (!summary && block.toolName.endsWith('__session_rename')) summary = p.title ? String(p.title) : undefined
    if (!summary && block.toolName.endsWith('__session_tag')) {
      const add = Array.isArray(p.add) ? p.add.filter((t: unknown): t is string => typeof t === 'string') : []
      const set = Array.isArray(p.set) ? p.set.filter((t: unknown): t is string => typeof t === 'string') : []
      const bits = add.length ? add : set
      summary = bits.length ? bits.join(', ') : undefined
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

export function extractCodeBlockTokens(text: string): Array<{ language: string; tokens: [string, string | null][][] | null }> | undefined {
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
    const mappedType = remoteToolBlockType(block.toolName)
    return { ...block, type: mappedType, input: sanitizeRemoteToolInput(block.toolName, block.input), toolSummary: block.toolSummary ?? meta.toolSummary, toolFilePath: block.toolFilePath ?? meta.toolFilePath, toolLineDelta: block.toolLineDelta ?? meta.toolLineDelta, toolDiff: block.toolDiff ?? meta.toolDiff, toolDiffTokens: block.toolDiffTokens ?? meta.toolDiffTokens, toolTodos: block.toolTodos ?? meta.toolTodos, subagentType: meta.subagentType, toolPrompt: meta.toolPrompt, runInBackground: meta.runInBackground, workflowName: meta.workflowName, workflowDescription: meta.workflowDescription, workflowPhases: meta.workflowPhases } as ContentBlock
  }
  if (block.type === 'tool_result') {
    if (bashCmds?.has(block.toolUseId)) {
      const output = truncateBashOutput(block.summary)
      return { type: 'bash_result', toolUseId: block.toolUseId, summary: output, parentToolUseId: block.parentToolUseId, outputTokens: parseAnsiTokens(output) }
    }
    if (block.summary.startsWith('{"ok":true,"shareId":')) {
      return block
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
  if (event.type === 'permission_request') {
    return enrichPermissionRequest(event)
  }
  return event
}

function appendRemoteErrorText(msg: ChatMessage): ChatMessage {
  const raw = msg.metadata?.errorInfo?.raw
  if (!raw) return msg
  if (msg.content.some((b) => b.type === 'text' && b.text.includes(raw))) return msg
  return { ...msg, content: [...msg.content, { type: 'text', text: `Error: ${raw}` }] }
}

export function stripMessagesForRemote(messages: ChatMessage[], projectPath?: string): ChatMessage[] {
  return messages.map(appendRemoteErrorText).map((msg) => {
    // The WebView uses the same Codex item reducer as desktop. Flattening the
    // snapshot loses the baseline needed by subsequent item patches and makes
    // the next item replace the visible turn with only its newest content.
    if (msg.metadata?.codex) return msg
    const bashCmds = new Map<string, string>()
    const todoInputs = new Map<string, { toolName: string; input: string }>()
    const widgetIds = new Set<string>()
    const agentIds = new Set<string>()
    const workflowIds = new Set<string>()
    const resultSummaries = new Map<string, string>()
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.toolName === 'Bash') {
        try { const p = JSON.parse(block.input); bashCmds.set(block.toolUseId, String(p.command ?? '')) } catch {}
      }
      if (block.type === 'tool_use' && TODO_TOOLS.has(block.toolName)) {
        todoInputs.set(block.toolUseId, { toolName: block.toolName, input: block.input })
      }
      if (block.type === 'tool_use' && block.toolName.endsWith('__widget_show')) {
        widgetIds.add(block.toolUseId)
      }
      if (block.type === 'tool_use' && isSubagentToolName(block.toolName)) {
        agentIds.add(block.toolUseId)
      }
      if (block.type === 'tool_use' && block.toolName === 'Workflow') {
        workflowIds.add(block.toolUseId)
      }
      if (block.type === 'tool_result') {
        resultSummaries.set(block.toolUseId, block.summary)
      }
    }
    const workflowAgentsById = new Map<string, ReturnType<typeof listWorkflowAgentsSync>>()
    for (const id of workflowIds) {
      const dir = parseWorkflowTranscriptDir(resultSummaries.get(id))
      if (!dir) continue
      const agents = listWorkflowAgentsSync(dir)
      if (agents.length > 0) workflowAgentsById.set(id, agents)
    }
    return {
      ...msg,
      content: msg.content
        .filter((b) => !(b.type === 'tool_use' && TODO_TOOLS.has(b.toolName)))
        .flatMap((b) => {
          if (b.type === 'tool_result' && todoInputs.has(b.toolUseId)) {
            const entry = todoInputs.get(b.toolUseId)!
            const toolTodos = resolveTodoToolTodos(entry.toolName, entry.input, b.toolTodos)
            return { type: 'todo_result' as const, toolUseId: b.toolUseId, summary: b.summary, parentToolUseId: b.parentToolUseId, todoToolName: entry.toolName, toolTodos }
          }
          if (b.type === 'tool_result' && widgetIds.has(b.toolUseId)) return b
          if (b.type === 'text') {
            const { segments } = splitTextIntoBlocks(b.text)
            if (segments.length <= 1) return stripContentBlock(b, bashCmds, agentIds, projectPath)
            return segments.map((seg) =>
              seg.type === 'insight'
                ? { type: 'insight', title: seg.title!, content: seg.content!, parentToolUseId: b.parentToolUseId, codeBlockTokens: extractCodeBlockTokens(seg.content!) } satisfies ContentBlock
                : stripContentBlock({ ...b, text: seg.text } as ContentBlock, bashCmds, agentIds, projectPath),
            )
          }
          const stripped = stripContentBlock(b, bashCmds, agentIds, projectPath)
          if (b.type === 'tool_use' && b.toolName === 'Workflow') {
            const agents = workflowAgentsById.get(b.toolUseId)
            if (agents) return { ...stripped, workflowAgents: agents } as ContentBlock
          }
          return stripped
        }),
    }
  })
}

/** Include completed items from the active turn, not only its streaming row. */
export function remoteRestoreMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { start = i; break }
  }
  const streaming = messages.findIndex((message) => message.status === 'streaming')
  if (streaming >= 0) start = Math.min(start, streaming)
  return messages.slice(start)
}

