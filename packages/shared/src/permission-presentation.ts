import type { PermissionRequest } from './agent-types'

export const permissionTitleTemplates = {
  externalDirectory: 'Access External Directory {{target}}',
  read: 'Read {{target}}',
  edit: 'Edit {{target}}',
  list: 'List {{target}}',
  shell: 'Run Shell Command',
  glob: 'Glob "{{target}}"',
  grep: 'Grep "{{target}}"',
  subagent: '{{target}} Subagent',
  webfetch: 'Fetch {{target}}',
  websearch: 'Search the Web for "{{target}}"',
  skill: 'Load Skill {{target}}',
  tool: 'Call Tool {{target}}',
} as const

export interface PermissionPresentation {
  kind: keyof typeof permissionTitleTemplates
  icon: 'folder' | 'file-text' | 'file-edit' | 'terminal' | 'search' | 'globe' | 'bot' | 'book-open' | 'wrench'
  target: string
  lines: string[]
  command?: string
  directory?: string
  diff?: string
  patch?: string
  editInput?: Record<string, unknown>
}

function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Strip the wildcard for the title only. The approval body keeps the exact resources. */
export function permissionDirectory(value: string): string {
  const wildcard = value.indexOf('*')
  if (wildcard < 0) return value
  const prefix = value.slice(0, wildcard)
  return /^[\\/]+$/.test(prefix) || /^[A-Za-z]:[\\/]$/.test(prefix) ? prefix : prefix.replace(/[\\/]+$/, '')
}

/** Action-specific presentation, matching OpenCode V2's CLI without exposing protocol IDs. */
export function permissionPresentation(request: PermissionRequest): PermissionPresentation | null {
  const details = request.permissionDetails
  if (!details || request.requestKind) return null
  const input = details.source?.input ?? {}
  const metadata = details.metadata ?? {}
  const resources = details.resources
  const path = text(input.path) || text(input.filePath) || text(input.file_path) || text(input.filepath) || resources[0] || ''
  const action = ({ bash: 'shell', write: 'edit', patch: 'edit', task: 'subagent' } as Record<string, string>)[details.action] ?? details.action
  const base = { target: path, lines: resources }
  switch (action) {
    case 'external_directory': return { ...base, kind: 'externalDirectory', icon: 'folder', target: permissionDirectory(text(metadata.parentDir) || text(metadata.filepath) || resources[0] || '') }
    case 'read': return { ...base, kind: 'read', icon: 'file-text' }
    case 'list': return { ...base, kind: 'list', icon: 'folder' }
    case 'edit': {
      const first = record(Array.isArray(metadata.files) ? metadata.files[0] : undefined)
      const diff = request.toolDiff || text(first.patch) || text(first.diff) || text(metadata.diff)
      return { ...base, kind: 'edit', icon: 'file-edit', diff: diff || undefined, patch: diff ? undefined : text(input.patchText) || undefined,
        editInput: { ...input, file_path: path, old_string: input.old_string ?? input.oldString, new_string: input.new_string ?? input.newString ?? input.content } }
    }
    case 'shell': return { ...base, kind: 'shell', icon: 'terminal', target: '', command: text(input.command) || text(metadata.command) || undefined,
      directory: text(input.workdir) || text(input.cwd) || text(input.directory) || undefined }
    case 'glob':
    case 'grep': return { ...base, kind: action, icon: 'search', target: text(input.pattern) || resources[0] || '' }
    case 'subagent': return { ...base, kind: 'subagent', icon: 'bot', target: text(input.agent) || text(input.subagent_type) || resources[0] || 'general',
      lines: text(input.description) ? [text(input.description)] : resources }
    case 'webfetch': return { ...base, kind: 'webfetch', icon: 'globe', target: text(input.url) || text(metadata.url) || resources[0] || '' }
    case 'websearch': return { ...base, kind: 'websearch', icon: 'search', target: text(input.query) || text(metadata.query) || resources[0] || '' }
    case 'skill': return { ...base, kind: 'skill', icon: 'book-open', target: text(input.id) || text(input.name) || resources[0] || '' }
    default: return { ...base, kind: 'tool', icon: 'wrench', target: details.action }
  }
}

export function permissionPresentationTitle(presentation: PermissionPresentation, translate: (template: string) => string = value => value, formatPath: (path: string) => string = value => value): string {
  const target = ['externalDirectory', 'read', 'edit', 'list'].includes(presentation.kind) ? formatPath(presentation.target) : presentation.target
  return translate(permissionTitleTemplates[presentation.kind]).replace('{{target}}', target)
}

export function canRememberPermission(request: PermissionRequest): boolean {
  return !request.requestKind && request.allowAlwaysAllow && (request.permissionDetails?.save?.length ?? 0) > 0
}
