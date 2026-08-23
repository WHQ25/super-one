import { beforeEach, describe, expect, it } from 'vitest'
import {
  evaluateMiniappFixedToolPermission,
  MINIAPP_CALL_QUALIFIED,
  MINIAPP_LIST_QUALIFIED,
  parseMiniappCallArgs,
  setMiniappPreapproveLookup,
  shouldAutoAllowMiniappTool,
} from './miniapp-call-policy'

describe('miniapp-call-policy', () => {
  const preapproved = new Set<string>()

  beforeEach(() => {
    preapproved.clear()
    setMiniappPreapproveLookup({
      isAppToolPreapproved: (appId, tool) => preapproved.has(`${appId}::${tool}`),
    })
  })

  it('always allows miniapp_list', () => {
    expect(evaluateMiniappFixedToolPermission(MINIAPP_LIST_QUALIFIED).decision).toBe('allow')
    expect(shouldAutoAllowMiniappTool(MINIAPP_LIST_QUALIFIED)).toBe(true)
  })

  it('allows miniapp_call only when that app tool is preapproved', () => {
    const input = { appId: 'hello', tool: 'render_data', input: { data: [] } }
    expect(evaluateMiniappFixedToolPermission(MINIAPP_CALL_QUALIFIED, input).decision).toBe('prompt')

    preapproved.add('hello::render_data')
    expect(evaluateMiniappFixedToolPermission(MINIAPP_CALL_QUALIFIED, input).decision).toBe('allow')
    expect(shouldAutoAllowMiniappTool(MINIAPP_CALL_QUALIFIED, input)).toBe(true)
  })

  it('denies miniapp_call when appId or tool is missing (self-correctable)', () => {
    const missing = evaluateMiniappFixedToolPermission(MINIAPP_CALL_QUALIFIED, { input: {} })
    expect(missing.decision).toBe('deny')
    expect(missing.reason).toMatch(/appId and tool/)
  })

  it('legacy appId__tool names still honor preapprove set', () => {
    preapproved.add('hello::render_data')
    expect(
      evaluateMiniappFixedToolPermission('mcp__superone__hello__render_data', { data: [] }).decision,
    ).toBe('allow')
    expect(
      evaluateMiniappFixedToolPermission('mcp__superone__hello__other', {}).decision,
    ).toBe('prompt')
  })

  it('parseMiniappCallArgs extracts nested input record', () => {
    expect(parseMiniappCallArgs({
      appId: ' weather ',
      tool: ' forecast ',
      input: { city: 'Tokyo' },
    })).toEqual({
      appId: 'weather',
      tool: 'forecast',
      toolInput: { city: 'Tokyo' },
    })
  })
})
