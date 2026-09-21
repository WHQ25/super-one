import { describe, expect, it } from 'vitest'
import { browserActionsFailure, parseReply, runBrowserActions, type PrimitiveRunner } from './browser-act'
import { browserErrorReply, browserTextReply } from './browser-mcp-replies'

function runner(log: Array<[string, Record<string, unknown>]>, fail?: (name: string) => unknown): PrimitiveRunner {
  return async (name, args) => {
    log.push([name, args])
    const failure = fail?.(name)
    if (failure instanceof Error) return browserErrorReply(failure)
    if (failure) return browserTextReply(failure)
    return browserTextReply({ ok: true, name })
  }
}

describe('runBrowserActions', () => {
  it('maps each action to its primitive on the tab, in order, and replies as browser_act does', async () => {
    const log: Array<[string, Record<string, unknown>]> = []
    const reply = await runBrowserActions(runner(log), [
      { type: 'click', selector: '#new' },
      { type: 'type', selector: '#title', text: 'Hello', engine: 'auto' },
      { type: 'press', key: 'Enter', engine: 'cdp' },
    ], { tab: 'b1', description: 'File the issue' })
    expect(log).toEqual([
      ['browser_click', { selector: '#new', tab: 'b1', description: 'File the issue' }],
      // `engine: auto` is the default and is not passed down; an explicit engine is.
      ['browser_type', { selector: '#title', text: 'Hello', tab: 'b1', description: 'File the issue' }],
      ['browser_press', { key: 'Enter', engine: 'cdp', tab: 'b1', description: 'File the issue' }],
    ])
    expect(reply.isError).toBeUndefined()
    expect(parseReply(reply)).toEqual({ ok: true, stepsExecuted: 3, last: { ok: true, name: 'browser_press' } })
    expect(browserActionsFailure(reply)).toBeNull()
  })

  it('stops at the first failure and names the step, whether the primitive errored or answered ok:false', async () => {
    const log: Array<[string, Record<string, unknown>]> = []
    const reply = await runBrowserActions(runner(log, (name) => name === 'browser_click' ? { ok: false, error: 'No element matches #gone' } : undefined), [
      { type: 'hover', selector: '#menu' },
      { type: 'click', selector: '#gone' },
      { type: 'press', key: 'Enter' },
    ], { tab: 'b1' })
    expect(log.map(([name]) => name)).toEqual(['browser_hover', 'browser_click'])
    expect(reply.isError).toBe(true)
    expect(parseReply(reply)).toEqual({ ok: false, failedAt: 'click', step: 1, executed: [{ type: 'hover', ok: true }], error: 'No element matches #gone' })
    expect(browserActionsFailure(reply)).toBe('No element matches #gone')

    const errored = await runBrowserActions(runner([], () => new Error('CDP target detached')), [{ type: 'click', selector: '#a' }], {})
    expect(errored.isError).toBe(true)
    expect(browserActionsFailure(errored)).toBe('[Error] CDP target detached')
  })

  it('refuses an action type browser_act does not have', async () => {
    const log: Array<[string, Record<string, unknown>]> = []
    const reply = await runBrowserActions(runner(log), [{ type: 'tap', x: 1, y: 2 }], {})
    expect(log).toEqual([])
    expect(reply.isError).toBe(true)
    expect(browserActionsFailure(reply)).toContain('Unknown action type: tap')
  })
})
