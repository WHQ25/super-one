import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkflowAgentRow } from '@superone/shared/agent-types'

export interface AgentJsonlSummary {
  label: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
}

interface JsonlRecord {
  type?: string
  message?: {
    id?: string
    content?: string | Array<{ type?: string; text?: string }>
    usage?: {
      input_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      output_tokens?: number
    }
  }
}

/** Prompt first line, tool_use count, and token total from one agent transcript. */
export function summarizeAgentJsonl(raw: string, agentId: string): AgentJsonlSummary {
  let label = agentId
  let prompt: string | undefined
  let toolCount = 0
  // One API response is written as one record per content block, each repeating
  // the same usage; key output by message id so a response counts once.
  const outputByMessage = new Map<string, number>()
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
        outputByMessage.set(rec.message.id ?? `#${outputByMessage.size}`, usage.output_tokens ?? 0)
        // Prompt caching moves most of the prompt out of input_tokens.
        lastInputTokens = (usage.input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0)
      }
      for (const block of rec.message.content) {
        if (block.type === 'tool_use') toolCount++
        else if (block.type === 'text' && block.text) resultText = block.text
      }
    }
  }
  let outputTokens = 0
  for (const n of outputByMessage.values()) outputTokens += n
  // Same measure as the CLI's task usage: latest prompt size plus all output.
  const tokens = outputTokens + lastInputTokens || undefined
  return { label, prompt, toolCount, tokens, resultText }
}

/** Claude `agent-*.jsonl` rows for a workflow transcript directory. Missing dir is empty. */
export function listWorkflowAgentsSync(transcriptDir: string): WorkflowAgentRow[] {
  let files: string[]
  try {
    files = readdirSync(transcriptDir)
  } catch {
    return []
  }
  const jsonls = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).sort()
  const out: WorkflowAgentRow[] = []
  for (const file of jsonls) {
    const agentId = file.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    try {
      const summary = summarizeAgentJsonl(readFileSync(join(transcriptDir, file), 'utf8'), agentId)
      out.push({ label: summary.label, toolCount: summary.toolCount, tokens: summary.tokens })
    } catch {
      out.push({ label: agentId, toolCount: 0 })
    }
  }
  return out
}
