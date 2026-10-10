import { resolveTestProject } from './project-rpc.test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { encodeMcpMentionValue, wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { mcpMentionContentForModel, previewMcpMention } from './mention-search'

const bolt = wrapMcpResourceMention(encodeMcpMentionValue('bits', 'cad://hex'), 'Hex bolt')
const client = (reply: unknown) => ({ resolveProject: resolveTestProject, rpc: vi.fn(async () => reply) })

describe('MCP resource content at send', () => {
  it('reads what the tags name and returns the agent-only block, as the desktop composer does', async () => {
    const host = client({ resources: [{ server: 'bits', uri: 'cad://hex', text: 'Grade 8.8' }] })
    const block = await mcpMentionContentForModel(host, '/work', 's1', `Use ${bolt}`)
    expect(host.rpc).toHaveBeenCalledWith('mcp.readMentions', expect.objectContaining({
      projectId: 'p', sessionId: 's1', targets: [{ server: 'bits', uri: 'cad://hex' }],
    }), { environmentId: 'desktop', timeoutMs: 20_000 })
    expect(block).toContain('<superone-mcp-resource-content>')
    expect(block).toContain('Grade 8.8')
  })

  it('asks nothing without tags, and sends the tags alone when the read fails', async () => {
    const quiet = client({})
    expect(await mcpMentionContentForModel(quiet, '/work', 's1', 'plain @text')).toBe('')
    expect(quiet.rpc).not.toHaveBeenCalled()
    expect(await mcpMentionContentForModel(client({ error: 'gone' }), '/work', 's1', bolt)).toBe('')
  })
})

describe('composer chip preview', () => {
  it('reads one chip and reuses the answer when it is opened again', async () => {
    const host = client({ resources: [{ server: 'bits', uri: 'cad://preview', text: 'x' }] })
    const value = encodeMcpMentionValue('bits', 'cad://preview')
    expect(await previewMcpMention(host, '/work', 's1', value)).toMatchObject({ text: 'x' })
    await previewMcpMention(host, '/work', 's1', value)
    expect(host.rpc).toHaveBeenCalledTimes(1)
  })
})
