import { getSubagentMessages } from '@anthropic-ai/claude-agent-sdk'

export interface SubagentTranscriptRecord {
  type: string
  message: { content: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> }
}

/**
 * Derives (sessionId, agentId) from a subagent transcript path. Handles both
 * standard subagents (`.../<sessionId>/subagents/agent-<id>.jsonl`) and
 * workflow-nested agents (`.../<sessionId>/subagents/workflows/wf_x/agent-<id>.jsonl`).
 */
export function parseTranscriptPath(outputFile: string): { sessionId: string; agentId: string } | null {
  const agentMatch = outputFile.match(/agent-([^/\\]+)\.jsonl$/)
  if (!agentMatch) return null
  const idx = outputFile.search(/[/\\]subagents[/\\]/)
  if (idx < 0) return null
  const sessionId = outputFile.slice(0, idx).split(/[/\\]/).pop()
  if (!sessionId) return null
  return { sessionId, agentId: agentMatch[1] }
}

/** Slim SDK SessionMessages down to the assistant records the renderer mapper needs. */
export function slimSubagentMessages(messages: Array<{ type?: string; message?: unknown }>): SubagentTranscriptRecord[] {
  const out: SubagentTranscriptRecord[] = []
  for (const m of messages) {
    if (m.type !== 'assistant') continue
    const msg = m.message as { content?: unknown } | undefined
    if (!msg || !Array.isArray(msg.content)) continue
    const content = msg.content
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .map((b) => ({
        type: String(b.type ?? ''),
        ...(b.name !== undefined ? { name: String(b.name) } : {}),
        ...(b.input !== undefined ? { input: b.input as Record<string, unknown> } : {}),
        ...(b.text !== undefined ? { text: String(b.text) } : {}),
      }))
    out.push({ type: 'assistant', message: { content } })
  }
  return out
}

/**
 * Authoritative read of a completed subagent's full conversation via the SDK
 * (parentUuid chain-building, no line-tail truncation). Returns null when the
 * path can't be parsed or the transcript can't be read.
 */
export async function readSubagentTranscript(outputFile: string, dir?: string): Promise<SubagentTranscriptRecord[] | null> {
  const ids = parseTranscriptPath(outputFile)
  if (!ids) return null
  try {
    const messages = await getSubagentMessages(ids.sessionId, ids.agentId, dir ? { dir } : undefined)
    return slimSubagentMessages(messages)
  } catch {
    return null
  }
}
