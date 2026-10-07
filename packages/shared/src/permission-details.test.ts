import { describe, expect, it } from 'vitest'
import type { PermissionRequest } from './agent-types'
import { permissionDetailMessage, permissionDetailSections, permissionDetailSummary } from './permission-details'
import { nodePendingToPermissionRequest } from './node-session-messages'

const request: PermissionRequest = {
  requestId: 'per_1', toolName: 'external_directory', input: {}, allowAlwaysAllow: true,
  message: '/outside/*',
  permissionDetails: {
    action: 'external_directory', resources: ['/outside/*'], save: ['/*'],
    source: { toolName: 'read', toolUseId: 'call_1', messageId: 'msg_1', input: { path: '/outside/a.md', limit: 100 } },
    metadata: { nested: { reason: 'Reference' } },
  },
}

describe('permission review details', () => {
  it('keeps scope, source, arguments, metadata and saved patterns as distinct lossless values', () => {
    const sections = permissionDetailSections(request)
    expect(sections.map(({ id }) => id)).toEqual(['action', 'resources', 'source', 'toolInput', 'metadata', 'save'])
    expect(JSON.parse(sections.find(({ id }) => id === 'toolInput')!.value)).toEqual(request.permissionDetails!.source!.input)
    expect(JSON.parse(sections.find(({ id }) => id === 'metadata')!.value)).toEqual({ nested: { reason: 'Reference' } })
    expect(permissionDetailMessage(request)).toBe('')
    expect(permissionDetailMessage({ ...request, message: 'Explain the reason' })).toBe('Explain the reason')
    expect(permissionDetailSummary(request)).toBe('/outside/*')
    expect(permissionDetailSummary(request, '/outside/a.md')).toBe('/outside/*')
    expect(permissionDetailSummary({ ...request, permissionDetails: undefined, message: 'Run shell command' }, 'git status')).toBe('git status')
    expect(permissionDetailSections({ ...request, permissionDetails: { action: 'mcp_tool', resources: ['*'], source: { toolName: 'mcp_tool', input: {} } } }).find(({ id }) => id === 'toolInput')!.value).toBe('{}')
  })

  it('does not invent arguments when restoring a request without tool events', () => {
    const restored = { ...request, permissionDetails: { action: 'shell', resources: ['git status'], source: { toolUseId: 'call_1' } } }
    expect(permissionDetailSections(restored).map(({ id }) => id)).toEqual(['action', 'resources', 'source'])
    expect(permissionDetailSections({ ...request, permissionDetails: undefined })).toEqual([])
  })

  it('keeps full long resources and legacy messages instead of shortening approval scope', () => {
    const path = `/outside/${'long-directory/'.repeat(100)}*`
    const details = { action: 'external_directory', resources: [path, '/second/*'] }
    expect(permissionDetailSections({ ...request, permissionDetails: details }).find(({ id }) => id === 'resources')!.value).toBe(`${path}\n/second/*`)
    expect(permissionDetailMessage({ ...request, permissionDetails: undefined })).toBe('/outside/*')
  })

  it('retains the same review context when reconnecting to a remote pending request', () => {
    const mapped = nodePendingToPermissionRequest({ ...request, interactionId: request.requestId, kind: 'permission' })
    expect(mapped?.permissionDetails).toEqual(request.permissionDetails)
    expect(mapped?.allowAlwaysAllow).toBe(true)
  })
})
