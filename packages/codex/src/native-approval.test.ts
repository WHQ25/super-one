import { expect, it } from 'vitest'
import { codexNativeApprovalRequest, codexNativeApprovalResult } from './native-approval'
import { permissionDetailSections } from '@superone/shared/permission-details'
import { permissionPresentation } from '@superone/shared/permission-presentation'
it('exposes requested additional filesystem and network grants to the reviewer', () => {
  const additionalPermissions = { fileSystem: { write: ['/outside'], read: ['/reference'] }, network: { enabled: true } }
  const mapped = codexNativeApprovalRequest('p', 'item/commandExecution/requestApproval', { kind: 'humanCommand', command: 'build', additionalPermissions })!
  const sections = permissionDetailSections(mapped)
  expect(sections.some(section => section.value.includes('/outside') && section.value.includes('/reference') && section.value.includes('network'))).toBe(true)
  expect(permissionPresentation(mapped)).toMatchObject({ command: 'build', additionalScope: JSON.stringify(additionalPermissions, null, 2) })
  expect(mapped.allowAlwaysAllow).toBe(false)
  expect(codexNativeApprovalResult({ additionalPermissions }, { decision: 'acceptForSession' })).toEqual({ decision: 'accept' })
})
