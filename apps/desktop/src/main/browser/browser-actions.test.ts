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

  it('detects nested action cycles inside control-flow steps', () => {
    saveBrowserAction(action({
      name: 'first',
      parameters: [],
      steps: [{
        kind: 'if',
        condition: true,
        then: [{ kind: 'action', domain: 'example.com', name: 'second', input: {} }],
      }],
    }))

    expect(() => saveBrowserAction(action({
      name: 'second',
      parameters: [],
      steps: [{
        kind: 'repeat',
        times: 1,
        steps: [{ kind: 'action', domain: 'example.com', name: 'first', input: {} }],
      }],
    }))).toThrow(/cycle detected/i)
    expect(listBrowserActions().map((item) => item.name)).toEqual(['first'])
  })

  it('limits the total number of defined steps across control-flow branches', () => {
    expect(() => saveBrowserAction(action({
      parameters: [],
      steps: [{
        kind: 'if',
        condition: true,
        then: Array.from({ length: 50 }, () => ({ kind: 'tool', tool: 'browser_tabs', args: {} })),
      }],
    }))).toThrow(/at most 50 steps/i)
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
  it('passes typed values through variables, branches, and bounded loops in order', async () => {
    saveBrowserAction(action({
      name: 'process_results',
      parameters: [
        { name: 'offset', type: 'number' },
        { name: 'repeats', type: 'number' },
      ],
      steps: [
        { kind: 'tool', tool: 'browser_query', args: { selector: '.result' }, saveAs: 'query' },
        {
          kind: 'set',
          name: 'total',
          value: {
            kind: 'op',
            op: 'add',
            args: [
              { kind: 'ref', path: 'vars.query.count' },
              { kind: 'ref', path: 'input.offset' },
            ],
          },
        },
        {
          kind: 'if',
          condition: {
            kind: 'op',
            op: 'gte',
            args: [{ kind: 'ref', path: 'vars.total' }, 4],
          },
          then: [{ kind: 'tool', tool: 'browser_click', args: { selector: '${vars.query.selector}' } }],
          else: [{ kind: 'tool', tool: 'browser_hover', args: { selector: '#empty' } }],
        },
        {
          kind: 'forEach',
          items: { kind: 'ref', path: 'vars.query.items' },
          steps: [{ kind: 'tool', tool: 'browser_type', args: { selector: '#log', text: '${item.label}:${index}' } }],
        },
        {
          kind: 'repeat',
          times: { kind: 'ref', path: 'input.repeats' },
          steps: [{ kind: 'tool', tool: 'browser_press', args: { key: 'iteration-${index}' } }],
        },
      ],
    }))
    const executeTool = vi.fn(async (tool: string) => tool === 'browser_query'
      ? okReply({ count: 2, selector: '#run', items: [{ label: 'alpha' }, { label: 'beta' }] })
      : okReply({ ok: true, tool }))

    const result = await executeBrowserAction({
      domain: 'example.com',
      name: 'process_results',
      input: { offset: 2, repeats: 2 },
      executeTool,
    })

    expect(result).toMatchObject({ ok: true, stepsExecuted: 10, lastResult: { ok: true, tool: 'browser_press' } })
    expect(executeTool).toHaveBeenNthCalledWith(1, 'browser_query', { selector: '.result' })
    expect(executeTool).toHaveBeenNthCalledWith(2, 'browser_click', { selector: '#run' })
    expect(executeTool).toHaveBeenNthCalledWith(3, 'browser_type', { selector: '#log', text: 'alpha:0' })
    expect(executeTool).toHaveBeenNthCalledWith(4, 'browser_type', { selector: '#log', text: 'beta:1' })
    expect(executeTool).toHaveBeenNthCalledWith(5, 'browser_press', { key: 'iteration-0' })
    expect(executeTool).toHaveBeenNthCalledWith(6, 'browser_press', { key: 'iteration-1' })
  })

  it('shares variables with nested actions and saves their last result', async () => {
    saveBrowserAction(action({
      name: 'child',
      parameters: [],
      steps: [
        { kind: 'tool', tool: 'browser_query', args: { selector: '#value' }, saveAs: 'child_result' },
        {
          kind: 'set',
          name: 'combined',
          value: {
            kind: 'op',
            op: 'add',
            args: [
              { kind: 'ref', path: 'vars.seed' },
              { kind: 'ref', path: 'vars.child_result.value' },
            ],
          },
        },
      ],
    }))
    saveBrowserAction(action({
      name: 'parent',
      parameters: [],
      steps: [
        { kind: 'set', name: 'seed', value: 2 },
        { kind: 'action', domain: 'example.com', name: 'child', input: {}, saveAs: 'nested_result' },
        {
          kind: 'tool',
          tool: 'browser_evaluate',
          args: { expression: '${vars.combined}', nested: '${vars.nested_result.value}' },
        },
      ],
    }))
    const executeTool = vi.fn(async (tool: string) => tool === 'browser_query'
      ? okReply({ value: 5 })
      : okReply({ ok: true }))

    const result = await executeBrowserAction({ domain: 'example.com', name: 'parent', executeTool })

    expect(result).toMatchObject({ ok: true, stepsExecuted: 5 })
    expect(executeTool).toHaveBeenLastCalledWith('browser_evaluate', { expression: 7, nested: 5 })
  })

  it('short-circuits boolean expressions and executes the else branch', async () => {
    saveBrowserAction(action({
      name: 'check_optional_value',
      parameters: [],
      steps: [{
        kind: 'if',
        condition: {
          kind: 'op',
          op: 'and',
          args: [
            { kind: 'op', op: 'exists', args: [{ kind: 'ref', path: 'vars.optional' }] },
            { kind: 'op', op: 'gt', args: [{ kind: 'ref', path: 'vars.optional.count' }, 0] },
          ],
        },
        then: [{ kind: 'tool', tool: 'browser_click', args: { selector: '#present' } }],
        else: [{ kind: 'tool', tool: 'browser_hover', args: { selector: '#missing' } }],
      }],
    }))
    const executeTool = vi.fn(async () => okReply())

    const result = await executeBrowserAction({ domain: 'example.com', name: 'check_optional_value', executeTool })

    expect(result).toMatchObject({ ok: true, stepsExecuted: 2 })
    expect(executeTool).toHaveBeenCalledOnce()
    expect(executeTool).toHaveBeenCalledWith('browser_hover', { selector: '#missing' })
  })

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

  it('enforces expression arity, loop bounds, and the cumulative step budget inside loops', async () => {
    expect(() => saveBrowserAction(action({
      parameters: [],
      steps: [{ kind: 'set', name: 'invalid', value: { kind: 'op', op: 'not', args: [true, false] } }],
    }))).toThrow(/expects 1 argument/i)

    saveBrowserAction(action({
      name: 'too_many_iterations',
      parameters: [],
      steps: [{ kind: 'repeat', times: 51, steps: [{ kind: 'tool', tool: 'browser_tabs', args: {} }] }],
    }))
    const executeTool = vi.fn(async () => okReply())
    const tooMany = await executeBrowserAction({ domain: 'example.com', name: 'too_many_iterations', executeTool })
    expect(tooMany).toMatchObject({ ok: false, error: expect.stringContaining('maximum of 50 iterations') })
    expect(executeTool).not.toHaveBeenCalled()

    saveBrowserAction(action({
      name: 'loop_budget',
      parameters: [],
      steps: [{
        kind: 'repeat',
        times: 50,
        steps: [
          { kind: 'tool', tool: 'browser_tabs', args: {} },
          { kind: 'tool', tool: 'browser_tabs', args: {} },
        ],
      }],
    }))
    const budget = await executeBrowserAction({ domain: 'example.com', name: 'loop_budget', executeTool })
    expect(budget).toMatchObject({ ok: false, stepsExecuted: 100, error: expect.stringContaining('maximum of 100 steps') })
    expect(executeTool).toHaveBeenCalledTimes(99)
  })
})
