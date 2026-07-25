import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

const electron = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
}))

import {
  executeBrowserAction,
  listBrowserActions,
  MAX_BROWSER_ACTION_DEPTH,
  resolveBrowserActionTemplates,
  saveBrowserAction,
} from './browser-actions'
import type { BrowserToolReply } from '../mcp/browser-mcp-replies'

const okReply = (data: unknown = { ok: true }): BrowserToolReply => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
})

function action(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: 'example.com',
    name: 'search',
    description: 'Search the example site',
    parameters: [{ name: 'query', type: 'string' }],
    steps: [{ kind: 'tool', tool: 'browser_type', args: { selector: '#q', text: '${input.query}' } }],
    ...overrides,
  }
}

beforeEach(() => {
  electron.userData = mkdtempSync(join(tmpdir(), 'superone-browser-actions-'))
})

afterEach(() => {
  rmSync(electron.userData, { recursive: true, force: true })
})

describe('browser action store', () => {
  it('normalizes domains, sorts actions, filters exactly, and replaces an existing key', () => {
    expect(saveBrowserAction(action({ domain: 'HTTPS://Example.COM/path', name: 'zeta' })).created).toBe(true)
    saveBrowserAction(action({ domain: 'other.test', name: 'middle' }))
    saveBrowserAction(action({ name: 'alpha' }))

    expect(listBrowserActions().map((item) => `${item.domain}/${item.name}`)).toEqual([
      'example.com/alpha',
      'example.com/zeta',
      'other.test/middle',
    ])
    expect(listBrowserActions('EXAMPLE.com.').map((item) => item.name)).toEqual(['alpha', 'zeta'])

    const replaced = saveBrowserAction(action({ name: 'alpha', description: 'Replacement' }))
    expect(replaced.created).toBe(false)
    expect(listBrowserActions('example.com').find((item) => item.name === 'alpha')?.description).toBe('Replacement')
  })

  it('writes a versioned store atomically and rejects invalid primitive tools', () => {
    saveBrowserAction(action())
    const stored = JSON.parse(readFileSync(join(electron.userData, 'browser-actions.json'), 'utf8'))
    expect(stored).toMatchObject({ version: 1, actions: [{ domain: 'example.com', name: 'search' }] })
    expect(() => saveBrowserAction(action({
      steps: [{ kind: 'tool', tool: 'browser_action_do', args: {} }],
    }))).toThrow(/Invalid option|browser_action_do/)
  })

  it('allows unresolved nested references but rejects a cycle once it becomes known', () => {
    saveBrowserAction(action({
      name: 'first',
      parameters: [],
      steps: [{ kind: 'action', domain: 'example.com', name: 'second', input: {} }],
    }))
    expect(() => saveBrowserAction(action({
      name: 'second',
      parameters: [],
      steps: [{ kind: 'action', domain: 'example.com', name: 'first', input: {} }],
    }))).toThrow(/cycle detected/i)
    expect(listBrowserActions().map((item) => item.name)).toEqual(['first'])
  })

  it('does not silently replace a corrupt store', () => {
    writeFileSync(join(electron.userData, 'browser-actions.json'), '{broken')
    expect(() => listBrowserActions()).toThrow(/Cannot read browser actions/)
    expect(() => saveBrowserAction(action())).toThrow(/Cannot read browser actions/)
    expect(readFileSync(join(electron.userData, 'browser-actions.json'), 'utf8')).toBe('{broken')
  })
})

describe('browser action templates', () => {
  it('preserves the type of an exact placeholder and interpolates embedded values', () => {
    expect(resolveBrowserActionTemplates({
      exact: '${input.filters}',
      url: 'https://example.com?q=${input.query}',
    }, {
      filters: ['open', 'closed'],
      query: 'hello',
    })).toEqual({
      exact: ['open', 'closed'],
      url: 'https://example.com?q=hello',
    })
  })

  it('rejects a missing template input', () => {
    expect(() => resolveBrowserActionTemplates('${input.missing}', {})).toThrow(/missing input/)
  })
})

describe('browser action execution', () => {
  it('runs nested actions, maps parent input, inherits tab, and returns the last result', async () => {
    saveBrowserAction(action({
      name: 'fill_search',
      steps: [{ kind: 'tool', tool: 'browser_type', args: { selector: '#q', text: '${input.query}' } }],
    }))
    saveBrowserAction(action({
      name: 'submit_search',
      parameters: [{ name: 'term', type: 'string' }],
      steps: [
        { kind: 'action', domain: 'EXAMPLE.COM', name: 'fill_search', input: { query: '${input.term}' } },
        { kind: 'tool', tool: 'browser_press', args: { key: 'Enter' } },
      ],
    }))
    const executeTool = vi.fn(async (tool: string) => okReply({ ok: true, tool }))

    const result = await executeBrowserAction({
      domain: 'example.com',
      name: 'submit_search',
      input: { term: 'semantic actions' },
      tab: 'tab-7',
      executeTool,
    })

    expect(result).toEqual({
      ok: true,
      action: 'example.com/submit_search',
      stepsExecuted: 3,
      lastResult: { ok: true, tool: 'browser_press' },
    })
    expect(executeTool).toHaveBeenNthCalledWith(1, 'browser_type', {
      selector: '#q',
      text: 'semantic actions',
      tab: 'tab-7',
    })
    expect(executeTool).toHaveBeenNthCalledWith(2, 'browser_press', { key: 'Enter', tab: 'tab-7' })
  })

  it('fails before executing when required input is missing or has the wrong type', async () => {
    saveBrowserAction(action())
    const executeTool = vi.fn(async () => okReply())

    const missing = await executeBrowserAction({ domain: 'example.com', name: 'search', executeTool })
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('Missing required input') })
    const wrongType = await executeBrowserAction({ domain: 'example.com', name: 'search', input: { query: 2 }, executeTool })
    expect(wrongType).toMatchObject({ ok: false, error: expect.stringContaining('must be string') })

    saveBrowserAction(action({ parameters: [{ name: 'query', type: 'object' }] }))
    const nullObject = await executeBrowserAction({ domain: 'example.com', name: 'search', input: { query: null }, executeTool })
    expect(nullObject).toMatchObject({ ok: false, error: expect.stringContaining('must be object') })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('treats a primitive JSON ok:false result as a failure without relying on isError', async () => {
    saveBrowserAction(action())
    const executeTool = vi.fn(async () => okReply({ ok: false, error: 'input is not editable' }))

    const result = await executeBrowserAction({
      domain: 'example.com',
      name: 'search',
      input: { query: 'x' },
      executeTool,
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'input is not editable',
      failedStep: { target: 'browser_type' },
    })
  })

  it('propagates a primitive failure with its nested call stack and step location', async () => {
    saveBrowserAction(action({ name: 'child' }))
    saveBrowserAction(action({
      name: 'parent',
      parameters: [{ name: 'query' }],
      steps: [{ kind: 'action', domain: 'example.com', name: 'child', input: { query: '${input.query}' } }],
    }))
    const executeTool = vi.fn(async (): Promise<BrowserToolReply> => ({
      content: [{ type: 'text', text: '[Error] field not found' }],
      isError: true,
    }))

    const result = await executeBrowserAction({
      domain: 'example.com',
      name: 'parent',
      input: { query: 'x' },
      executeTool,
    })

    expect(result).toMatchObject({
      ok: false,
      action: 'example.com/parent',
      stepsExecuted: 2,
      error: 'field not found',
      callStack: ['example.com/parent', 'example.com/child'],
      failedStep: { action: 'example.com/child', index: 0, target: 'browser_type' },
    })
  })

  it('guards against runtime cycles and excessive nesting even if the store was edited externally', async () => {
    const cyclic = {
      version: 1,
      actions: [
        action({ name: 'a', parameters: [], steps: [{ kind: 'action', domain: 'example.com', name: 'b', input: {} }] }),
        action({ name: 'b', parameters: [], steps: [{ kind: 'action', domain: 'example.com', name: 'a', input: {} }] }),
      ],
    }
    writeFileSync(join(electron.userData, 'browser-actions.json'), JSON.stringify(cyclic))
    const executeTool = vi.fn(async () => okReply())
    const cycle = await executeBrowserAction({ domain: 'example.com', name: 'a', executeTool })
    expect(cycle).toMatchObject({ ok: false, error: expect.stringContaining('cycle detected') })

    const deepActions = Array.from({ length: MAX_BROWSER_ACTION_DEPTH + 1 }, (_, index) => action({
      name: `level_${index}`,
      parameters: [],
      steps: index === MAX_BROWSER_ACTION_DEPTH
        ? [{ kind: 'tool', tool: 'browser_tabs', args: {} }]
        : [{ kind: 'action', domain: 'example.com', name: `level_${index + 1}`, input: {} }],
    }))
    writeFileSync(join(electron.userData, 'browser-actions.json'), JSON.stringify({ version: 1, actions: deepActions }))
    const depth = await executeBrowserAction({ domain: 'example.com', name: 'level_0', executeTool })
    expect(depth).toMatchObject({ ok: false, error: expect.stringContaining('maximum depth') })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('enforces one cumulative step budget across the nested action tree', async () => {
    const tools = (count: number) => Array.from({ length: count }, () => ({
      kind: 'tool',
      tool: 'browser_tabs',
      args: {},
    }))
    const actions = [
      action({
        name: 'root',
        parameters: [],
        steps: [...tools(49), { kind: 'action', domain: 'example.com', name: 'child', input: {} }],
      }),
      action({
        name: 'child',
        parameters: [],
        steps: [...tools(49), { kind: 'action', domain: 'example.com', name: 'leaf', input: {} }],
      }),
      action({ name: 'leaf', parameters: [], steps: tools(2) }),
    ]
    writeFileSync(join(electron.userData, 'browser-actions.json'), JSON.stringify({ version: 1, actions }))
    const executeTool = vi.fn(async () => okReply())

    const result = await executeBrowserAction({ domain: 'example.com', name: 'root', executeTool })

    expect(result).toMatchObject({ ok: false, stepsExecuted: 100, error: expect.stringContaining('maximum of 100 steps') })
    expect(executeTool).toHaveBeenCalledTimes(98)
  })
})
