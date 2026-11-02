import { expect, it } from 'vitest'
import { buildCodexSandboxPolicy } from './sandbox-policy'
import { resolveCodexPermissionProfile } from './permission-profile'

it('resolves an unset Codex preset to auto-review and full access to never', () => {
  expect(resolveCodexPermissionProfile(null)).toMatchObject({
    permissionPreset: 'auto-review',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
  })
  expect(resolveCodexPermissionProfile('full-access')).toMatchObject({
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
  })
  expect(buildCodexSandboxPolicy('/work', resolveCodexPermissionProfile('read-only'))).toEqual({
    type: 'readOnly',
    access: { type: 'fullAccess' },
  })
  expect(buildCodexSandboxPolicy('/work', resolveCodexPermissionProfile('full-access'))).toEqual({
    type: 'dangerFullAccess',
  })
})
