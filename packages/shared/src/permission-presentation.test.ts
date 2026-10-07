import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from './agent-types'
import { canRememberPermission, permissionDirectory, permissionPresentation, permissionPresentationTitle } from './permission-presentation'

function request(action: string, resources: string[], input?: Record<string, unknown>, metadata?: Record<string, unknown>): PermissionRequest {
  return { requestId: 'per_1', toolName: action, input: {}, allowAlwaysAllow: true,
    permissionDetails: { action, resources, metadata, source: input ? { input, toolUseId: 'not-the-last-call' } : undefined } }
}

describe('semantic permission presentation', () => {
  it('uses an external directory title and folder icon, retaining every exact approval pattern', () => {
    const presentation = permissionPresentation(request('external_directory', ['/outside/reference/*', '/other/*'], { path: '/outside/reference/spec.md' }))!
    expect(presentation).toMatchObject({ kind: 'externalDirectory', icon: 'folder', target: '/outside/reference', lines: ['/outside/reference/*', '/other/*'] })
    expect(permissionPresentationTitle(presentation)).toBe('Access External Directory /outside/reference')
    expect(permissionDirectory('/*')).toBe('/')
    expect(permissionDirectory('C:/*')).toBe('C:/')
  })

  it('uses the correlated shell call rather than treating permission resources as tool arguments', () => {
    expect(permissionPresentation(request('shell', ['git status', 'git diff'], { command: 'git status && git diff', workdir: '/repo' }))).toMatchObject({
      kind: 'shell', icon: 'terminal', command: 'git status && git diff', directory: '/repo', lines: ['git status', 'git diff'],
    })
    expect(permissionPresentation(request('shell', ['git status']))).toMatchObject({ lines: ['git status'], command: undefined })
  })

  it('previews edit diffs and preserves native argument aliases', () => {
    const input = { filePath: '/outside/a.ts', oldString: 'a', newString: 'b' }
    expect(permissionPresentation(request('edit', ['/outside/a.ts'], input, { diff: '@@ -1 +1 @@\n-a\n+b' }))).toMatchObject({
      kind: 'edit', icon: 'file-edit', target: '/outside/a.ts', diff: '@@ -1 +1 @@\n-a\n+b', editInput: { file_path: '/outside/a.ts', old_string: 'a', new_string: 'b' },
    })
    expect(input).toEqual({ filePath: '/outside/a.ts', oldString: 'a', newString: 'b' })
  })

  it('only offers remembered approval when the request supplies save patterns and allows persistence', () => {
    const item = request('external_directory', ['/outside/*'])
    expect(canRememberPermission(item)).toBe(false)
    item.permissionDetails!.save = ['/outside/*']
    expect(canRememberPermission(item)).toBe(true)
    expect(canRememberPermission({ ...item, allowAlwaysAllow: false })).toBe(false)
    expect(canRememberPermission({ ...item, requestKind: 'terminal_command_confirm' })).toBe(false)
  })
})
