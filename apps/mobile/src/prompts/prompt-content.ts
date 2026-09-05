import { diffLines } from 'diff'
import type { PermissionRequest } from '@superone/shared/agent-types'

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function permissionToolContent(request: PermissionRequest) {
  const input = request.input
  const filePath = stringValue(input.file_path ?? input.path)
  const command = stringValue(input.command ?? input.cmd)
  const target = stringValue(input.host ?? input.url ?? input.query ?? input.pattern)
  const oldText = stringValue(input.old_string)
  const newText = stringValue(input.new_string ?? input.content)
  return {
    filePath,
    fileName: filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
    command,
    target,
    description: stringValue(input.description),
    sandboxOverride: input.dangerouslyDisableSandbox === true,
    diff: request.toolDiff || (request.toolName === 'Write' && newText ? newText.split('\n').map((line) => `+${line}`).join('\n') : '') || (request.toolName === 'Edit' && (oldText || newText)
      ? diffLines(oldText, newText).flatMap((change) => change.value.replace(/\n$/, '').split('\n').map((line) => `${change.added ? '+' : change.removed ? '-' : ' '}${line}`)).join('\n')
      : ''),
    content: request.toolName === 'Write' ? newText : '',
    rawInput: !filePath && !command && !target && Object.keys(input).length ? JSON.stringify(input, null, 2) : '',
  }
}

export function showRememberPermission(request: PermissionRequest): boolean {
  if (request.requestKind) return true
  return request.allowAlwaysAllow && !request.suggestions?.length
    && !['Edit', 'Write', 'NotebookEdit'].includes(request.toolName)
}

export function diffLineTone(line: string): 'added' | 'removed' | 'meta' | 'context' {
  if (/^(?:@@|---|\+\+\+|diff |index )/.test(line)) return 'meta'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}
