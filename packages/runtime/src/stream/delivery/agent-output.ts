import { readFileSync } from 'node:fs'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'

/**
 * Claude `agent-*.jsonl` and Grok child `chat_history.jsonl` share one reader.
 * The desktop and a remote node both fill phone subagent rows from it.
 */
export interface AgentOutput {
  resultText?: string
  toolEntries: Array<{ toolName: string; description: string }>
}

interface TranscriptRecord {
  type?: string
  content?: string | Array<{ type?: string; text?: string }>
  message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> }
  tool_calls?: Array<{ name?: string; arguments?: string | Record<string, unknown> }>
}

function parseTranscriptArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readTranscriptLines(raw: string): TranscriptRecord[] {
  const records: TranscriptRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { records.push(JSON.parse(line) as TranscriptRecord) } catch { /* skip a torn tail line */ }
  }
  return records
}

export function extractResultText(raw: string): string | undefined {
  let lastText: string | undefined
  for (const record of readTranscriptLines(raw)) {
    if (record.type !== 'assistant') continue
    // Grok writes the assistant text on the record; Claude nests it under message.content.
    if (typeof record.content === 'string' && record.content.trim() && record.message == null) {
      lastText = record.content
      continue
    }
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        if (block?.type === 'text' && block.text) lastText = block.text
      }
    }
    for (const block of record.message?.content ?? []) {
      if (block.type === 'text' && block.text) lastText = block.text
    }
  }
  return lastText
}

function shortenProjectPath(value: string, projectPath?: string): string {
  if (!projectPath) return value
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/'
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function summarizeToolInput(input: Record<string, unknown>, projectPath?: string): string {
  if (input.file_path) return shortenProjectPath(String(input.file_path), projectPath)
  if (input.target_file) return shortenProjectPath(String(input.target_file), projectPath)
  if (input.command) return String(input.command).slice(0, 120)
  if (input.pattern) {
    const path = input.path != null ? ` in ${shortenProjectPath(String(input.path), projectPath)}` : ''
    return `${String(input.pattern).slice(0, 80)}${path}`.slice(0, 160)
  }
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.path) return shortenProjectPath(String(input.path), projectPath)
  if (input.target_directory) return shortenProjectPath(String(input.target_directory), projectPath)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  if (input.description) return String(input.description).slice(0, 120)
  return ''
}

export function extractToolEntries(raw: string, projectPath?: string): Array<{ toolName: string; description: string }> {
  const entries: Array<{ toolName: string; description: string }> = []
  const push = (rawName: string, rawInput: Record<string, unknown>): void => {
    const { toolName, input } = normalizeTranscriptTool(rawName, rawInput)
    entries.push({ toolName, description: summarizeToolInput(input, projectPath) })
  }
  for (const record of readTranscriptLines(raw)) {
    if (record.type !== 'assistant') continue
    // Grok child sessions: top-level tool_calls. Not Claude's message.content tool_use.
    if (Array.isArray(record.tool_calls)) {
      for (const call of record.tool_calls) {
        if (typeof call.name === 'string' && call.name) push(call.name, parseTranscriptArguments(call.arguments))
      }
      continue
    }
    for (const block of record.message?.content ?? []) {
      if (block.type === 'tool_use' && block.name) push(block.name, block.input ?? {})
    }
  }
  return entries
}

export function readAgentOutputText(raw: string, projectPath?: string): AgentOutput {
  return { resultText: extractResultText(raw), toolEntries: extractToolEntries(raw, projectPath) }
}

/** Missing or unreadable transcripts yield no rows. Callers keep their fallback. */
export function readAgentOutputFile(outputFile: string, projectPath?: string): AgentOutput {
  try {
    return readAgentOutputText(readFileSync(outputFile, 'utf-8'), projectPath)
  } catch {
    return { toolEntries: [] }
  }
}
