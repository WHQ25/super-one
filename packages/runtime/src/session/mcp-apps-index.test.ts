import { describe, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { McpAppAttachmentIndex } from './mcp-apps-index'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, resourceUri: 'ui://fixture/view', approvedTools: [{ node: 'node', session: 's', server: 'fixture', configFingerprint: 'config', tool: 'next_page' }] }

describe('node MCP App attachment index', () => {
  it('reuses the catalog until durable state changes and returns only the scoped target plus consent', () => {
    const catalog = vi.fn(() => [{ id: 'm', metadata: { codex: { items: [{ app }] } } }])
    const index = new McpAppAttachmentIndex()
    expect(index.resolve('s', 'view', '1', catalog)).toEqual({ messageId: 'm', app, sessionApprovals: app.approvedTools })
    index.resolve('s', 'view', '1', catalog)
    expect(catalog).toHaveBeenCalledOnce()
    catalog.mockReturnValueOnce([{ id: 'm', metadata: { codex: { items: [{ app: { ...app, resource: { html: 'persisted', hash: 'hash', meta: {} } } }] } } }])
    expect(index.resolve('s', 'view', '2', catalog).app.resource?.html).toBe('persisted')
    expect(catalog).toHaveBeenCalledTimes(2)
    expect(() => index.resolve('s', 'missing', '2', catalog)).toThrow('not found')
  })

  it('collects unique session approvals across both native attachment shapes', () => {
    const other = { ...app, appInstanceId: 'other', approvedTools: [...app.approvedTools!, { ...app.approvedTools![0]!, tool: 'select' }] }
    const index = new McpAppAttachmentIndex()
    const target = index.resolve('s', 'other', '1', () => [{ id: 'a', metadata: { codex: { items: [{ app }] } } }, { id: 'b', content: [{ type: 'tool_result', toolUseId: 'call', summary: '', app: other }] }])
    expect(target.messageId).toBe('b')
    expect(target.sessionApprovals.map(value => value.tool)).toEqual(['next_page', 'select'])
  })

  it('drops a removed session index instead of reusing it for a new catalog', () => {
    const index = new McpAppAttachmentIndex()
    index.resolve('s', 'view', '1', () => [{ id: 'm', metadata: { codex: { items: [{ app }] } } }])
    index.delete('s')
    expect(() => index.resolve('s', 'view', '1', () => [])).toThrow('not found')
  })
})
