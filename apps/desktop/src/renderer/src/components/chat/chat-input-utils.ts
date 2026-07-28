export {
  formatCodexModelLabel,
  formatCodexModelName,
} from '@superone/shared/codex-model-label'

export function formatReasoningEffortLabel(value: string): string {
  switch (value) {
    case 'minimal': return 'Minimal'
    case 'low': return 'Low'
    case 'medium': return 'Medium'
    case 'high': return 'High'
    case 'xhigh': return 'Extra High'
    default: return value
  }
}

export function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function toMentionPath(filePath: string, projectPath?: string | null): string {
  const normalizedFilePath = normalizeFilePath(filePath)
  const normalizedProjectPath = projectPath ? normalizeFilePath(projectPath).replace(/\/+$/, '') : ''
  if (!normalizedProjectPath) return normalizedFilePath
  if (normalizedFilePath === normalizedProjectPath) return '.'
  if (normalizedFilePath.startsWith(`${normalizedProjectPath}/`)) {
    return normalizedFilePath.slice(normalizedProjectPath.length + 1)
  }
  return normalizedFilePath
}
