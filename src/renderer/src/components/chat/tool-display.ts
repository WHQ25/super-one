/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'wrench'

export interface ToolDisplay {
  icon: ToolIcon
  summary: string
}

export function getToolDisplay(toolName: string, input: Record<string, unknown>): ToolDisplay {
  switch (toolName) {
    case 'Bash':
      return { icon: 'terminal', summary: String(input.command ?? '') }
    case 'Read':
      return { icon: 'file-text', summary: String(input.file_path ?? '') }
    case 'Edit':
      return { icon: 'file-edit', summary: String(input.file_path ?? '') }
    case 'Write':
    case 'NotebookEdit':
      return { icon: 'file-plus', summary: String(input.file_path ?? input.notebook_path ?? '') }
    case 'Grep':
      return { icon: 'search', summary: `${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}` }
    case 'Glob':
      return { icon: 'folder-search', summary: `${input.pattern ?? ''}${input.path ? ` in ${input.path}` : ''}` }
    default:
      return { icon: 'wrench', summary: '' }
  }
}

/** Parse a JSON string into a Record for tool display. */
export function parseToolInput(input: string): Record<string, unknown> {
  try { return JSON.parse(input) } catch { return {} }
}
