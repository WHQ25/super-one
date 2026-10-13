import { extractJsonStringValue } from '@superone/shared/partial-json'

// Kept in chat-core so reducer consumers never depend on a renderer component.

const PARTIAL_STRING_FIELDS: Record<string, string[]> = {
  Read: ['file_path'],
  Edit: ['file_path', 'old_string', 'new_string'],
  Write: ['file_path', 'content'],
  FileChange: ['file_path', 'kind', 'diff'],
  NotebookEdit: ['notebook_path', 'new_source', 'old_source'],
  Patch: ['patchText'],
  CodeExecution: ['code'],
}

const STRING_ALIASES: Record<string, string[]> = {
  file_path: ['filePath', 'path'],
  old_string: ['oldString'],
  new_string: ['newString'],
}

export function extractPartialToolInput(input: string, toolName?: string): Record<string, unknown> {
  if (toolName === 'Bash' && input.trim()) {
    const command = input.trimStart().startsWith('{') ? extractJsonStringValue(input, 'command') : input
    return command === undefined ? {} : { command }
  }
  const partial: Record<string, unknown> = {}
  const fields = toolName && PARTIAL_STRING_FIELDS[toolName]
  if (fields) {
    for (const key of fields) {
      const v = [key, ...(STRING_ALIASES[key] ?? [])]
        .map((alias) => extractJsonStringValue(input, alias)).find((value) => value !== undefined)
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
