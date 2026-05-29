import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface WorkflowAgentInfo {
  agentId: string
  jsonlPath: string
  label: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
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
      label = prompt.split('\n')[0].slice(0, 80)
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
  if (!filePath.endsWith('.js')) return null
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function listWorkflowAgents(transcriptDir: string): Promise<WorkflowAgentInfo[]> {
  let files: string[]
  try {
    files = await readdir(transcriptDir)
  } catch {
    return []
  }
  const jsonls = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).sort()
  const out: WorkflowAgentInfo[] = []
  for (const file of jsonls) {
    const jsonlPath = join(transcriptDir, file)
    const agentId = file.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    let summary: { label: string; prompt?: string; toolCount: number; resultText?: string } = { label: agentId, toolCount: 0 }
    try {
      summary = summarizeAgentJsonl(await readFile(jsonlPath, 'utf8'), agentId)
    } catch {
      // unreadable agent transcript — fall back to id-only row
    }
    out.push({ agentId, jsonlPath, ...summary })
  }
  return out
}
