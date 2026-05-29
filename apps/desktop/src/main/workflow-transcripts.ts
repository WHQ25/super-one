import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface WorkflowAgentInfo {
  agentId: string
  jsonlPath: string
  label: string
  toolCount: number
  resultText?: string
}

interface JsonlRecord {
  type?: string
  message?: { content?: string | Array<{ type?: string; text?: string }> }
}

function summarizeAgentJsonl(raw: string, agentId: string): { label: string; toolCount: number; resultText?: string } {
  let label = agentId
  let toolCount = 0
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
      label = rec.message.content.split('\n')[0].slice(0, 80)
      foundPrompt = true
    }
    if (rec.type === 'assistant' && Array.isArray(rec.message?.content)) {
      for (const block of rec.message.content) {
        if (block.type === 'tool_use') toolCount++
        else if (block.type === 'text' && block.text) resultText = block.text
      }
    }
  }
  return { label, toolCount, resultText }
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
    let summary: { label: string; toolCount: number; resultText?: string } = { label: agentId, toolCount: 0 }
    try {
      summary = summarizeAgentJsonl(await readFile(jsonlPath, 'utf8'), agentId)
    } catch {
      // unreadable agent transcript — fall back to id-only row
    }
    out.push({ agentId, jsonlPath, ...summary })
  }
  return out
}
