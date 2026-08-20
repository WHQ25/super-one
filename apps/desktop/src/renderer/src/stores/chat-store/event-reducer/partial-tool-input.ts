import { extractJsonStringValue } from '@superone/shared/partial-json'

const PARTIAL_STRING_FIELDS: Record<string, string[]> = {
  Edit: ['file_path', 'old_string', 'new_string'],
  Write: ['file_path', 'content'],
  FileChange: ['file_path', 'kind', 'diff'],
  NotebookEdit: ['notebook_path', 'new_source', 'old_source'],
}

export function extractPartialToolInput(input: string, toolName?: string): Record<string, unknown> {
  if (toolName === 'Bash' && input.trim()) return { command: input }
  const partial: Record<string, unknown> = {}
  const fields = toolName && PARTIAL_STRING_FIELDS[toolName]
  if (fields) {
    for (const key of fields) {
      const v = extractJsonStringValue(input, key)
      if (v !== undefined) partial[key] = v
    }
    return partial
  }
  const pathMatch = input.match(/"file_path"\s*:\s*"([^"]*)"/)
  if (pathMatch) partial.file_path = pathMatch[1]
  const nbMatch = input.match(/"notebook_path"\s*:\s*"([^"]*)"/)
  if (nbMatch) partial.notebook_path = nbMatch[1]
  return partial
}
