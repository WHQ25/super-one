// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { isFresh, observePage } from './browser-page'
import { buildActionSpace } from './action-space'
import { buildRequest } from './questions'
import { traceRequestState } from './trace'

vi.mock('../browser/browser-cdp', () => ({
  cdpSend: async (_id: number, _method: string, params: { expression: string }) => ({ result: { value: window.eval(params.expression) } }),
  cdpClick: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).__soneJev
})

it('never observes or serializes an autofilled password, including freshness guards', async () => {
  document.body.innerHTML = '<input type="password" aria-label="Password" value="fixture-secret">'
  const input = document.querySelector('input')!
  Object.defineProperty(input, 'checkVisibility', { configurable: true, value: () => true })
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 30 } as DOMRect)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => input })
  const observed = await observePage(1)
  expect(observed.elements).toMatchObject([{ password: true, value: '' }])
  expect(JSON.stringify(observed)).not.toContain('fixture-secret')
  expect(await isFresh(1, observed)).toBe(true)
  vi.mocked(input.getBoundingClientRect).mockReturnValue({ x: 200, y: 0, width: 100, height: 30 } as DOMRect)
  expect(await isFresh(1, observed)).toBe(false)
  // Defense in depth: a future adapter accidentally supplying a value cannot leak it either.
  observed.elements[0].value = 'fixture-secret'
  const space = buildActionSpace({ page: observed, history: [] })
  const request = buildRequest({ page: observed, space, goal: 'Open help', presets: [], history: [], last: undefined })
  expect(JSON.stringify([space, request, traceRequestState(request.state, [])])).not.toContain('fixture-secret')
})
