import { describe, expect, it } from 'vitest'
import { diffLineTone, permissionToolContent, showRememberPermission } from './prompt-content'
import type { PermissionRequest } from '@superone/shared/agent-types'

const request = (patch: Partial<PermissionRequest>): PermissionRequest => ({ requestId: 'test', toolName: 'Bash', input: {}, allowAlwaysAllow: true, ...patch })
describe('native permission details', () => {
  it('preserves full commands and identifies sandbox overrides', () => {
    expect(permissionToolContent(request({ input: { command: 'bun run typecheck\nbun run test', dangerouslyDisableSandbox: true, description: 'Validate changes' } }))).toMatchObject({ command: 'bun run typecheck\nbun run test', sandboxOverride: true, description: 'Validate changes' })
  })
  it('uses supplied diffs and handles Windows paths without losing the target', () => {
    expect(permissionToolContent(request({ toolName: 'Edit', input: { file_path: 'C:\\work\\app.ts', old_string: 'old', new_string: 'new' }, toolDiff: '@@ -1 +1 @@\n-old\n+new' }))).toMatchObject({ fileName: 'app.ts', filePath: 'C:\\work\\app.ts', diff: '@@ -1 +1 @@\n-old\n+new' })
    expect(diffLineTone('+++ b/app.ts')).toBe('meta')
    expect(diffLineTone('+new')).toBe('added')
  })
  it('shows edit content when remote diff metadata is missing', () => {
    expect(permissionToolContent(request({ toolName: 'Edit', input: { old_string: 'old', new_string: 'new' } })).diff).toBe('-old\n+new')
  })
  it('avoids competing persistent grants when explicit suggestions or edits are present', () => {
    expect(showRememberPermission(request({ suggestions: [{ type: 'addRules' }] }))).toBe(false)
    expect(showRememberPermission(request({ toolName: 'Edit' }))).toBe(false)
    expect(showRememberPermission(request({}))).toBe(true)
  })
})
