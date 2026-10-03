import { describe, expect, it } from 'vitest'
import type { CodexCollabToolCallItem, CodexMcpToolCallItem } from './agent-types'
import type { ToolAppAttachment } from './mcp-apps'
import { findMcpAppAttachment, mcpAppEventAttachments, mcpAppModelContextInput, mcpAppResourceHashes, mergeMcpAppBlocks, updateMcpAppAttachments } from './mcp-apps-state'

const app: ToolAppAttachment = { appInstanceId: 'child-view', binding: { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'cfg' }, origin: { providerSessionId: 'child' }, resourceUri: 'ui://fixture/view', status: 'result' }
const call = (value?: ToolAppAttachment): CodexMcpToolCallItem => ({ id: 'same-call-id', type: 'mcp_tool_call', server: 'fixture', tool: 'next', arguments: {}, status: 'completed', ...(value ? { app: value } : {}) })
const collab = (childItems: CodexCollabToolCallItem['childItems']): CodexCollabToolCallItem => ({ id: 'spawn', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: {}, childItems })
const message = (item: CodexCollabToolCallItem) => ({ id: 'm', metadata: { codex: { items: [item] } } })

describe('nested native MCP App state', () => {
  it('indexes, patches and retains child resource/context without mutating provider identities', () => {
    const source = [message(collab({ child: [collab({ grandchild: [call(app)] })], sibling: [call({ ...app, appInstanceId: 'other' })] }))]
    const update = { resource: { hash: 'a'.repeat(64), meta: {} }, modelContext: { updateId: 'selection', content: [{ type: 'text', text: 'selected dial' }], source: { appInstanceId: app.appInstanceId, server: 'fixture' } } }
    const next = updateMcpAppAttachments(source, app.appInstanceId, update)
    expect(findMcpAppAttachment(next, app.appInstanceId, 'm')).toMatchObject({ messageId: 'm', app: { ...app, ...update } })
    expect(findMcpAppAttachment(source, app.appInstanceId)?.app.resource).toBeUndefined()
    expect(findMcpAppAttachment(next, 'other')?.app.resource).toBeUndefined()
    expect(mcpAppResourceHashes(next)).toEqual(new Set(['a'.repeat(64)]))
    expect(mcpAppModelContextInput(next).text).toContain('selected dial')
    const cleared = updateMcpAppAttachments(next, app.appInstanceId, { modelContext: null })
    expect(mcpAppModelContextInput(cleared)).toEqual({ text: '', images: [] })
  })

  it('merges snapshots by collaboration id and child thread; same item ids cannot cross threads', () => {
    const saved = { ...app, resource: { hash: 'a'.repeat(64), meta: {} }, modelContext: null }
    const previous = [collab({ child: [call(saved)] })]
    const next = mergeMcpAppBlocks(previous, [collab({ child: [call({ ...app, status: 'pending' })], sibling: [call()] })])
    expect(findMcpAppAttachment([message(next[0]!)], app.appInstanceId)?.app).toMatchObject({ resource: saved.resource, modelContext: null })
    expect((next[0]!.childItems!.sibling![0] as CodexMcpToolCallItem).app).toBeUndefined()
    const omitted = mergeMcpAppBlocks(previous, [collab(undefined)])
    expect(findMcpAppAttachment([message(omitted[0]!)], app.appInstanceId)?.app.resource).toEqual(saved.resource)
    const newOrigin = mergeMcpAppBlocks(previous, [collab({ child: [call({ ...app, origin: { providerSessionId: 'unrelated' } })] })])
    expect(findMcpAppAttachment([message(newOrigin[0]!)], app.appInstanceId)?.app.resource).toBeUndefined()
  })

  it('returns every child attachment from a collaboration update', () => {
    expect(mcpAppEventAttachments({ type: 'codex_item_delta', messageId: 'm', phase: 'updated', item: collab({ child: [call(app)], sibling: [call({ ...app, appInstanceId: 'other' })] }) }).map(app => app.appInstanceId)).toEqual(['child-view', 'other'])
  })
})
