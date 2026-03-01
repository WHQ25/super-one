export type JsonlEntry =
  | { type: 'tool'; toolName: string; description: string }
  | { type: 'activity'; text: string }

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path)
  if (input.command) return String(input.command).slice(0, 120)
  if (input.pattern) return String(input.pattern)
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  if (input.description) return String(input.description).slice(0, 120)
  return ''
}

export function parseJsonlOutput(raw: string): { entries: JsonlEntry[]; resultText?: string } {
  const lines = raw.split('\n')
  const entries: JsonlEntry[] = []
  let lastTextIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let record: { type?: string; message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string }> } }
    try { record = JSON.parse(line) } catch {
      if (i === 0) return { entries: [] }
      continue
    }
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'tool_use' && block.name) {
        entries.push({ type: 'tool', toolName: block.name, description: summarizeToolInput(block.name, block.input ?? {}) })
      } else if (block.type === 'text' && block.text) {
        lastTextIndex = entries.length
        entries.push({ type: 'activity', text: block.text })
      }
    }
  }
  let resultText: string | undefined
  if (lastTextIndex >= 0) {
    resultText = (entries[lastTextIndex] as { type: 'activity'; text: string }).text
  }
  return { entries, resultText }
}
