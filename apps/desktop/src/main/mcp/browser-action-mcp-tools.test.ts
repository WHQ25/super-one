import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const electron = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
}))

import { registerBrowserActionTools } from './browser-action-mcp-tools'
import type { BrowserToolReply } from './browser-mcp-replies'

type Handler = (args: Record<string, unknown>) => Promise<BrowserToolReply>

function buildTools(executeTool = vi.fn(async (): Promise<BrowserToolReply> => ({
  content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
}))): { tools: Map<string, Handler>; executeTool: typeof executeTool } {
  const tools = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler)
      return {}
    },
  }
  registerBrowserActionTools(server as never, 'session-1', executeTool)
  return { tools, executeTool }
}

function text(reply: BrowserToolReply): string {
  return reply.content.map((content) => content.type === 'text' ? content.text : '').join('')
}

beforeEach(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'superone-browser-action-tools-'))
})

afterEach(() => {
  rmSync(electron.userData, { recursive: true, force: true })
})

describe('browser action MCP tools', () => {
  it('registers list, save, and do', () => {
    const { tools } = buildTools()
    expect([...tools.keys()]).toEqual(['browser_action_list', 'browser_action_save', 'browser_action_do'])
  })

  it('saves an action and lists compact or complete definitions by exact domain', async () => {
    const { tools } = buildTools()
    const definition = {
      domain: 'HTTPS://GitHub.COM/issues',
      name: 'open_issues',
      description: 'Open repository issues',
      parameters: [{ name: 'repository', type: 'string' }],
      steps: [{ kind: 'tool', tool: 'browser_navigate', args: { url: 'https://github.com/${input.repository}/issues' } }],
    }
    const save = await tools.get('browser_action_save')!(definition)
    expect(save.isError).toBeUndefined()
    expect(JSON.parse(text(save))).toMatchObject({ ok: true, created: true, action: { domain: 'github.com', stepCount: 1 } })

    await tools.get('browser_action_save')!({
      ...definition,
      domain: 'gitlab.com',
      name: 'open_merge_requests',
    })

    const compact = JSON.parse(text(await tools.get('browser_action_list')!({ domain: 'GITHUB.COM.' })))
    expect(compact).toMatchObject({ count: 1, actions: [{ domain: 'github.com', name: 'open_issues', stepCount: 1 }] })
    expect(compact.actions[0].steps).toBeUndefined()

    const complete = JSON.parse(text(await tools.get('browser_action_list')!({ domain: 'github.com', includeSteps: true })))
    expect(complete.actions[0].steps).toEqual(definition.steps)
  })

  it('executes a saved action through the session-scoped primitive dispatcher', async () => {
    const { tools, executeTool } = buildTools()
    await tools.get('browser_action_save')!({
      domain: 'example.com',
      name: 'search',
      description: 'Search example.com',
      parameters: [{ name: 'query', type: 'string' }],
      steps: [{ kind: 'tool', tool: 'browser_type', args: { selector: '#q', text: '${input.query}' } }],
    })

    const reply = await tools.get('browser_action_do')!({
      domain: 'example.com',
      name: 'search',
      input: { query: 'browser actions' },
      tab: 'tab-1',
    })

    expect(reply.isError).toBeUndefined()
    expect(JSON.parse(text(reply))).toMatchObject({ ok: true, action: 'example.com/search', stepsExecuted: 1 })
    expect(executeTool).toHaveBeenCalledWith('session-1', 'browser_type', {
      selector: '#q',
      text: 'browser actions',
      tab: 'tab-1',
    })
  })

  it('saves and executes flow control through the public MCP tools', async () => {
    const dispatcher = vi.fn(async (_sessionId: string, tool: string): Promise<BrowserToolReply> => ({
      content: [{ type: 'text', text: JSON.stringify(tool === 'browser_query' ? { count: 2 } : { ok: true }) }],
    }))
    const { tools } = buildTools(dispatcher)
    const save = await tools.get('browser_action_save')!({
      domain: 'example.com',
      name: 'open_when_ready',
      description: 'Open the item when results are ready',
      parameters: [],
      steps: [
        { kind: 'tool', tool: 'browser_query', args: { selector: '.item' }, saveAs: 'query' },
        {
          kind: 'if',
          condition: {
            kind: 'op',
            op: 'gt',
            args: [{ kind: 'ref', path: 'vars.query.count' }, 0],
          },
          then: [{ kind: 'tool', tool: 'browser_click', args: { selector: '.item' } }],
        },
      ],
    })
    expect(save.isError).toBeUndefined()
    expect(JSON.parse(text(save))).toMatchObject({ action: { stepCount: 3 } })

    const reply = await tools.get('browser_action_do')!({ domain: 'example.com', name: 'open_when_ready' })

    expect(reply.isError).toBeUndefined()
    expect(JSON.parse(text(reply))).toMatchObject({ ok: true, stepsExecuted: 3 })
    expect(dispatcher).toHaveBeenNthCalledWith(1, 'session-1', 'browser_query', { selector: '.item' })
    expect(dispatcher).toHaveBeenNthCalledWith(2, 'session-1', 'browser_click', { selector: '.item' })
  })

  it('marks lookup and child execution failures as MCP errors', async () => {
    const failingDispatcher = vi.fn(async (): Promise<BrowserToolReply> => ({
      content: [{ type: 'text', text: '[Error] button unavailable' }],
      isError: true,
    }))
    const { tools } = buildTools(failingDispatcher)

    const missing = await tools.get('browser_action_do')!({ domain: 'example.com', name: 'missing' })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('not found')

    await tools.get('browser_action_save')!({
      domain: 'example.com',
      name: 'submit',
      description: 'Submit the form',
      parameters: [],
      steps: [{ kind: 'tool', tool: 'browser_click', args: { selector: '#submit' } }],
    })
    const failed = await tools.get('browser_action_do')!({ domain: 'example.com', name: 'submit' })
    expect(failed.isError).toBe(true)
    expect(JSON.parse(text(failed))).toMatchObject({ ok: false, error: 'button unavailable' })
  })
})
