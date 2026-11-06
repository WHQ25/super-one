import { expect, it } from '@jest/globals'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { permissionPresentation } from '@superone/shared/permission-presentation'
import { renderWithTheme } from '../test-render'
import { ScopedPermissionContent } from './ScopedPermissionContent'

it.each(['dark', 'light'] as const)('shows the command and additional grants before expanding technical details (%s)', async color => {
  const request: PermissionRequest = {
    requestId: 'grants', toolName: 'Bash', input: { command: 'build release' }, allowAlwaysAllow: false,
    permissionDetails: { action: 'shell', resources: [], source: { input: { command: 'build release', cwd: '/project' } },
      metadata: { additionalPermissions: { fileSystem: { write: ['/outside'], read: ['/reference'] }, network: { enabled: true } } } },
  }
  const view = await renderWithTheme(<ScopedPermissionContent request={request} presentation={permissionPresentation(request)!} remembering={false} />, color)
  expect(view.getByText('$ build release')).toBeTruthy()
  expect(view.getByText('Working directory: /project')).toBeTruthy()
  const scope = view.getByText(/"fileSystem"/)
  expect(scope.props.children).toContain('/outside')
  expect(scope.props.children).toContain('/reference')
  expect(scope.props.children).toContain('network')
})
