import { describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { McpAppAttachmentIndex } from './mcp-apps-index'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, resourceUri: 'ui://fixture/view', status: 'result' }

describe('node MCP App attachment index', () => {
  it('reuses the catalog until durable state changes and returns only the scoped target', () => {
    const catalog = vi.fn(() => [{ id: 'm', metadata: { codex: { items: [{ app }] } } }])
    const index = new McpAppAttachmentIndex()
    expect(index.resolve('s', 'view', '1', catalog)).toEqual({ messageId: 'm', app })
    index.resolve('s', 'view', '1', catalog)
    expect(catalog).toHaveBeenCalledOnce()
    catalog.mockReturnValueOnce([{ id: 'm', metadata: { codex: { items: [{ app: { ...app, resource: { html: 'persisted', hash: 'hash', meta: {} } } }] } } }])
    expect(index.resolve('s', 'view', '2', catalog).app.resource?.html).toBe('persisted')
    expect(catalog).toHaveBeenCalledTimes(2)
    expect(() => index.resolve('s', 'missing', '2', catalog)).toThrow('not found')
  })

  it('resolves targets across both native attachment shapes', () => {
    const other = { ...app, appInstanceId: 'other' }
    const index = new McpAppAttachmentIndex()
    const target = index.resolve('s', 'other', '1', () => [{ id: 'a', metadata: { codex: { items: [{ app }] } } }, { id: 'b', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app: other }] }])
    expect(target.messageId).toBe('b')
    expect(target.app.appInstanceId).toBe('other')
  })

  it('drops a removed session index instead of reusing it for a new catalog', () => {
    const index = new McpAppAttachmentIndex()
    index.resolve('s', 'view', '1', () => [{ id: 'm', metadata: { codex: { items: [{ app }] } } }])
    index.delete('s')
    expect(() => index.resolve('s', 'view', '1', () => [])).toThrow('not found')
  })

  it('finds a nested child View under the parent message', () => {
    const index = new McpAppAttachmentIndex()
    const nested = { id: 'spawn', type: 'collab_tool_call', childItems: { child: [{ app }] } }
    expect(index.resolve('s', 'view', '1', () => [{ id: 'parent-message', metadata: { codex: { items: [nested] } } }])).toEqual({ messageId: 'parent-message', app })
  })
})
