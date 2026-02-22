export function formatCodexModelLabel(raw: string): string {
  const normalized = raw.trim().split('/').pop()?.trim() ?? raw.trim()
  if (!normalized) return raw
  const tokens = normalized
    .replace(/_/g, '-')
    .split(/[-\s]+/)
    .filter(Boolean)
  if (tokens.length === 0) return normalized
  return tokens.map((token) => {
    const lower = token.toLowerCase()
    if (lower === 'gpt') return 'GPT'
    if (/^\d+(\.\d+)*$/.test(token)) return token
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
  }).join('-')
}

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
