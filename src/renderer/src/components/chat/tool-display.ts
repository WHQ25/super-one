/** Shared tool name → icon key + summary extraction for ToolBlock & PermissionPrompt. */

export type ToolIcon = 'terminal' | 'file-text' | 'file-edit' | 'file-plus' | 'search' | 'folder-search' | 'globe' | 'wrench'

export interface ToolDisplay {
  icon: ToolIcon
  summary: string
}

/** Shorten an absolute file path: relative to cwd, or replace homedir with ~. */
export function shortenPath(filePath: string, cwd?: string, homedir?: string): string {
  if (!filePath) return filePath
  if (cwd && filePath.startsWith(cwd + '/')) {
    return filePath.slice(cwd.length + 1)
  }
  if (cwd && filePath === cwd) {
    return '.'
  }
  if (homedir && filePath.startsWith(homedir + '/')) {
    return '~/' + filePath.slice(homedir.length + 1)
  }
  if (homedir && filePath === homedir) {
    return '~'
  }
  return filePath
}

export function getToolDisplay(toolName: string, input: Record<string, unknown>, cwd?: string, homedir?: string): ToolDisplay {
  const sp = (p: string): string => shortenPath(p, cwd, homedir)

  switch (toolName) {
    case 'Bash':
      return { icon: 'terminal', summary: String(input.command ?? '') }
    case 'Read':
      return { icon: 'file-text', summary: sp(String(input.file_path ?? '')) }
    case 'Edit':
      return { icon: 'file-edit', summary: sp(String(input.file_path ?? '')) }
    case 'Write':
    case 'NotebookEdit':
      return { icon: 'file-plus', summary: sp(String(input.file_path ?? input.notebook_path ?? '')) }
    case 'Grep':
      return { icon: 'search', summary: `${input.pattern ?? ''}${input.path ? ` in ${sp(String(input.path))}` : ''}` }
    case 'Glob':
      return { icon: 'folder-search', summary: `${input.pattern ?? ''}${input.path ? ` in ${sp(String(input.path))}` : ''}` }
    case 'WebSearch':
      return { icon: 'globe', summary: String(input.query ?? '') }
    case 'WebFetch':
      return { icon: 'globe', summary: String(input.url ?? '') }
    default:
      return { icon: 'wrench', summary: '' }
  }
}

/** Parse a JSON string into a Record for tool display. */
export function parseToolInput(input: string): Record<string, unknown> {
  try { return JSON.parse(input) } catch { return {} }
}
