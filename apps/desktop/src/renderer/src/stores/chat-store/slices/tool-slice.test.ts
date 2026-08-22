import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import { createToolSlice, type ToolSlice } from './tool-slice'
import type { ToolRendererState } from '../types'

const submitToolIntercept = vi.fn()
const cancelToolIntercept = vi.fn()

vi.stubGlobal('window', { app: { submitToolIntercept, cancelToolIntercept } })

const makeStore = () =>
  create<ToolSlice>()((set, get, api) =>
    // tool-slice is self-contained: it only touches its own state, so casting
    // ChatStore-typed args to the local slice surface is safe here.
    createToolSlice(set as never, get as never, api as never),
  )

const awaitingRenderer = (
  callId: string,
  overrides: Partial<ToolRendererState> = {},
): ToolRendererState => ({
  callId,
  appId: 'app-1',
  toolSlug: 'hello',
  toolName: 'hello',
  toolUseId: 'use-1',
  templateUrl: 'about:blank',
  agentInput: {},
  status: 'awaiting',
  ...overrides,
})

beforeEach(() => {
  submitToolIntercept.mockReset()
  cancelToolIntercept.mockReset()
})

describe('tool intercept lifecycle', () => {
  it('registers a renderer when opened and overwrites the same callId on re-open', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1', { agentInput: { v: 1 } }))
    expect(store.getState().toolRenderers['call-1'].agentInput).toEqual({ v: 1 })

    store.getState().openToolIntercept(awaitingRenderer('call-1', { agentInput: { v: 2 } }))
    expect(store.getState().toolRenderers['call-1'].agentInput).toEqual({ v: 2 })

    store.getState().openToolIntercept(awaitingRenderer('call-2'))
    expect(Object.keys(store.getState().toolRenderers).sort()).toEqual(['call-1', 'call-2'])
  })

  it('submits user input, clears the renderer, and forwards to window.app once', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1'))
    store.getState().submitToolIntercept('call-1', { ok: true })

    expect(store.getState().toolRenderers['call-1']).toBeUndefined()
    expect(submitToolIntercept).toHaveBeenCalledTimes(1)
    expect(submitToolIntercept).toHaveBeenCalledWith('call-1', { ok: true })
  })

  it('ignores submit when callId is unknown', () => {
    const store = makeStore()
    store.getState().submitToolIntercept('ghost', { ok: true })
    expect(submitToolIntercept).not.toHaveBeenCalled()
    expect(store.getState().toolRenderers).toEqual({})
  })

  it('ignores duplicate submit after the renderer is gone — prevents double-fire', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1'))
    store.getState().submitToolIntercept('call-1', { v: 1 })
    store.getState().submitToolIntercept('call-1', { v: 2 })
    expect(submitToolIntercept).toHaveBeenCalledTimes(1)
    expect(submitToolIntercept).toHaveBeenCalledWith('call-1', { v: 1 })
  })

  it('ignores submit when the renderer status is not awaiting', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1', { status: 'submitted' }))
    store.getState().submitToolIntercept('call-1', { ok: true })

    expect(store.getState().toolRenderers['call-1']).toBeDefined()
    expect(submitToolIntercept).not.toHaveBeenCalled()
  })

  it('cancels with a reason, clears the renderer, and forwards to window.app', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1'))
    store.getState().cancelToolIntercept('call-1', 'user-closed')

    expect(store.getState().toolRenderers['call-1']).toBeUndefined()
    expect(cancelToolIntercept).toHaveBeenCalledWith('call-1', 'user-closed')
  })

  it('cancel without reason forwards undefined and still clears the renderer', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1'))
    store.getState().cancelToolIntercept('call-1')

    expect(cancelToolIntercept).toHaveBeenCalledWith('call-1', undefined)
    expect(store.getState().toolRenderers['call-1']).toBeUndefined()
  })

  it('ignores cancel when the renderer status is not awaiting', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1', { status: 'cancelled' }))
    store.getState().cancelToolIntercept('call-1', 'late')

    expect(cancelToolIntercept).not.toHaveBeenCalled()
    expect(store.getState().toolRenderers['call-1']).toBeDefined()
  })

  it('treats submit and cancel as mutually exclusive — second action is a no-op', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('call-1'))
    store.getState().submitToolIntercept('call-1', { v: 1 })
    store.getState().cancelToolIntercept('call-1', 'too-late')

    expect(submitToolIntercept).toHaveBeenCalledTimes(1)
    expect(cancelToolIntercept).not.toHaveBeenCalled()
  })
})

describe('clearToolIntercepts', () => {
  it('removes only the listed callIds and leaves the rest intact', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('a'))
    store.getState().openToolIntercept(awaitingRenderer('b'))
    store.getState().openToolIntercept(awaitingRenderer('c'))

    store.getState().clearToolIntercepts(['a', 'c'])
    expect(Object.keys(store.getState().toolRenderers).sort()).toEqual(['b'])
  })

  it('is a no-op on empty callIds and keeps the same reference', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('a'))
    const before = store.getState().toolRenderers

    store.getState().clearToolIntercepts([])
    expect(store.getState().toolRenderers).toBe(before)
  })

  it('silently skips unknown callIds while still removing the known ones', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('a'))
    store.getState().clearToolIntercepts(['ghost', 'a'])
    expect(store.getState().toolRenderers).toEqual({})
  })

  it('clears renderers regardless of their status (host-driven cleanup)', () => {
    const store = makeStore()
    store.getState().openToolIntercept(awaitingRenderer('a', { status: 'submitted' }))
    store.getState().openToolIntercept(awaitingRenderer('b', { status: 'cancelled' }))
    store.getState().openToolIntercept(awaitingRenderer('c', { status: 'awaiting' }))

    store.getState().clearToolIntercepts(['a', 'b', 'c'])
    expect(store.getState().toolRenderers).toEqual({})
  })
})
