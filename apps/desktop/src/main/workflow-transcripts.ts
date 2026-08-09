import { readdir, readFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WorkflowAgentSummary {
  label: string
  toolCount: number
  tokens?: number
}

export function listWorkflowAgentsSync(transcriptDir: string): WorkflowAgentSummary[] {
  let files: string[]
  try {
    files = readdirSync(transcriptDir)
  } catch {
    return []
  }
  const jsonls = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).sort()
  const out: WorkflowAgentSummary[] = []
  for (const file of jsonls) {
    const agentId = file.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    try {
      const s = summarizeAgentJsonl(readFileSync(join(transcriptDir, file), 'utf8'), agentId)
      out.push({ label: s.label, toolCount: s.toolCount, tokens: s.tokens })
    } catch {
      out.push({ label: agentId, toolCount: 0 })
    }
  }
  return out
}

export interface WorkflowAgentInfo {
  agentId: string
  jsonlPath: string
  label: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
  result?: unknown
  phase?: string
  state?: string
}

interface JsonlRecord {
  type?: string
  message?: {
    content?: string | Array<{ type?: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
}

function summarizeAgentJsonl(raw: string, agentId: string): { label: string; prompt?: string; toolCount: number; tokens?: number; resultText?: string } {
  let label = agentId
  let prompt: string | undefined
  let toolCount = 0
  let outputTokens = 0
  let lastInputTokens = 0
  let resultText: string | undefined
  let foundPrompt = false
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: JsonlRecord
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!foundPrompt && rec.type === 'user' && typeof rec.message?.content === 'string') {
      prompt = rec.message.content
      label = (prompt.split('\n').map((l) => l.trim()).find(Boolean) ?? agentId).slice(0, 80)
      foundPrompt = true
    }
    if (rec.type === 'assistant' && Array.isArray(rec.message?.content)) {
      const usage = rec.message.usage
      if (usage) {
        outputTokens += usage.output_tokens ?? 0
        lastInputTokens = usage.input_tokens ?? lastInputTokens
      }
      for (const block of rec.message.content) {
        if (block.type === 'tool_use') toolCount++
        else if (block.type === 'text' && block.text) resultText = block.text
      }
    }
  }
  const tokens = outputTokens + lastInputTokens || undefined
  return { label, prompt, toolCount, tokens, resultText }
}

export interface WorkflowOutputEnvelope {
  summary?: string
  agentCount?: number
  logs: string[]
  result?: unknown
}

export async function readWorkflowOutput(filePath: string): Promise<WorkflowOutputEnvelope | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object') return null
    const logs = Array.isArray(o.logs)
      ? o.logs.map((l) => (typeof l === 'string' ? l : (l as { message?: string })?.message ?? JSON.stringify(l)))
      : []
    return {
      summary: typeof o.summary === 'string' ? o.summary : undefined,
      agentCount: typeof o.agentCount === 'number' ? o.agentCount : undefined,
      logs,
      result: o.result,
    }
  } catch {
    return null
  }
}

export async function readWorkflowScript(filePath: string): Promise<string | null> {
  // Claude stores compiled JS under workflows/scripts/; Grok uses `.rhai` sources.
  if (!filePath.endsWith('.js') && !filePath.endsWith('.rhai')) return null
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function readJournalResults(transcriptDir: string): Promise<Map<string, unknown>> {
  const results = new Map<string, unknown>()
  let raw: string
  try {
    raw = await readFile(join(transcriptDir, 'journal.jsonl'), 'utf8')
  } catch {
    return results
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = JSON.parse(trimmed) as { type?: string; agentId?: string; result?: unknown }
      if (rec.type === 'result' && typeof rec.agentId === 'string' && rec.result !== undefined) {
        results.set(rec.agentId, rec.result)
      }
    } catch {
      continue
    }
  }
  return results
}

/**
 * Count tool_calls in a Grok child-session chat_history.jsonl (best-effort).
 * Format: {"type":"assistant","tool_calls":[{"name","arguments"}, ...]}
 */
function countGrokChatHistoryTools(raw: string): number {
  let n = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('tool_calls')) continue
    try {
      const rec = JSON.parse(trimmed) as { type?: string; tool_calls?: unknown[] }
      if (rec.type === 'assistant' && Array.isArray(rec.tool_calls)) n += rec.tool_calls.length
    } catch { /* skip */ }
  }
  return n
}

/**
 * Grok layout: transcriptDir is .../workflows/<run_id>/ with state.json + journal.
 * Meta/output: .../subagents/<agent_id>/{meta.json,output.json}
 * Full tool transcript: sibling child session .../<child_session_id>/chat_history.jsonl
 */
async function listGrokWorkflowAgents(transcriptDir: string): Promise<WorkflowAgentInfo[]> {
  let stateRaw: string
  try {
    stateRaw = await readFile(join(transcriptDir, 'state.json'), 'utf8')
  } catch {
    return []
  }
  let agents: Array<Record<string, unknown>> = []
  try {
    const root = JSON.parse(stateRaw) as Record<string, unknown>
    const state = (root.state && typeof root.state === 'object' ? root.state : root) as Record<string, unknown>
    if (Array.isArray(state.agents)) agents = state.agents as Array<Record<string, unknown>>
  } catch {
    return []
  }
  if (agents.length === 0) return []

  const journalResults = await readJournalResults(transcriptDir)
  // session_dir/subagents is sibling of workflows/; child sessions are siblings of session_dir.
  const sessionDir = join(transcriptDir, '..', '..')
  const sessionsRoot = join(sessionDir, '..')
  const subagentsDir = join(sessionDir, 'subagents')

  const out: WorkflowAgentInfo[] = []
  for (const row of agents) {
    const agentId = typeof row.agent_id === 'string' ? row.agent_id
      : typeof row.agentId === 'string' ? row.agentId
        : undefined
    if (!agentId) continue
    const label = typeof row.label === 'string' && row.label.trim()
      ? row.label
      : agentId
    const tokens = typeof row.tokens_used === 'number' ? row.tokens_used
      : typeof row.tokensUsed === 'number' ? row.tokensUsed
        : undefined
    const phase = typeof row.phase === 'string' && row.phase.trim() ? row.phase.trim() : undefined
    const state = typeof row.state === 'string' && row.state.trim() ? row.state.trim() : undefined

    let prompt: string | undefined
    let resultText: string | undefined
    let toolCount = 0
    let childSessionId = agentId
    const metaPath = join(subagentsDir, agentId, 'meta.json')
    const outputPath = join(subagentsDir, agentId, 'output.json')
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
      if (typeof meta.prompt === 'string') prompt = meta.prompt
      if (typeof meta.child_session_id === 'string' && meta.child_session_id) {
        childSessionId = meta.child_session_id
      } else if (typeof meta.childSessionId === 'string' && meta.childSessionId) {
        childSessionId = meta.childSessionId
      }
      if (typeof meta.tool_calls === 'number' && meta.tool_calls > 0) {
        toolCount = meta.tool_calls
      }
    } catch { /* no meta */ }
    try {
      const outJson = JSON.parse(await readFile(outputPath, 'utf8')) as Record<string, unknown>
      if (typeof outJson.output === 'string') resultText = outJson.output
      else if (typeof outJson.result === 'string') resultText = outJson.result
      else if (outJson.output != null) resultText = JSON.stringify(outJson.output, null, 2)
    } catch { /* no output yet */ }

    // Prefer chat_history.jsonl so the full view can stream tool activity (Claude-parity).
    const chatHistoryPath = join(sessionsRoot, childSessionId, 'chat_history.jsonl')
    let jsonlPath = outputPath
    try {
      const historyRaw = await readFile(chatHistoryPath, 'utf8')
      jsonlPath = chatHistoryPath
      if (toolCount === 0) toolCount = countGrokChatHistoryTools(historyRaw)
    } catch {
      // child session may still be spinning up
    }

    const journalResult = journalResults.get(agentId)
    if (resultText == null && journalResult !== undefined) {
      resultText = typeof journalResult === 'string' ? journalResult : JSON.stringify(journalResult, null, 2)
    }

    out.push({
      agentId,
      jsonlPath,
      label,
      prompt,
      toolCount,
      ...(tokens != null ? { tokens } : {}),
      ...(phase ? { phase } : {}),
      ...(state ? { state } : {}),
      ...(resultText != null ? { resultText } : {}),
      ...(journalResult !== undefined ? { result: journalResult } : {}),
    })
  }
  return out
}

export async function listWorkflowAgents(transcriptDir: string): Promise<WorkflowAgentInfo[]> {
  let files: string[]
  try {
    files = await readdir(transcriptDir)
  } catch {
    return []
  }
  const journalResults = await readJournalResults(transcriptDir)
  const jsonls = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).sort()
  const out: WorkflowAgentInfo[] = []
  for (const file of jsonls) {
    const jsonlPath = join(transcriptDir, file)
    const agentId = file.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    let summary: { label: string; prompt?: string; toolCount: number; tokens?: number; resultText?: string } = { label: agentId, toolCount: 0 }
    try {
      summary = summarizeAgentJsonl(await readFile(jsonlPath, 'utf8'), agentId)
    } catch {
      // unreadable agent transcript — fall back to id-only row
    }
    out.push({ agentId, jsonlPath, ...summary, result: journalResults.get(agentId) })
  }
  if (out.length > 0) return out
  // Grok Build: no Claude-style agent-*.jsonl — use state.json + session/subagents.
  return listGrokWorkflowAgents(transcriptDir)
}
