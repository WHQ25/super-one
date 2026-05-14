/** @vitest-environment jsdom */

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StandaloneToolBlock } from './StandaloneToolBlock'

const PROJECT_DIR = '/proj'
const PROJECT_ID = 'project-uuid'

const chatState = {
  _pendingStandaloneCalls: {} as Record<string, {
    callId: string; appId: string; projectDir: string; toolName: string; arguments: Record<string, unknown>
  }>,
}

const listeners = new Set<() => void>()

function setCallEntry(toolUseId: string, payload: typeof chatState._pendingStandaloneCalls[string]) {
  chatState._pendingStandaloneCalls = { ...chatState._pendingStandaloneCalls, [toolUseId]: payload }
  for (const cb of listeners) cb()
}

function resetChatState() {
  chatState._pendingStandaloneCalls = {}
}

vi.mock('@/stores/chat', () => ({
  useChatStore: <T,>(selector: (s: typeof chatState) => T): T => {
    const { useSyncExternalStore } = require('react')
    return useSyncExternalStore(
      (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) },
      () => selector(chatState),
    )
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: <T,>(selector: (s: { currentProjectId: string | null; currentFolder: string | null }) => T): T =>
    selector({ currentProjectId: PROJECT_ID, currentFolder: PROJECT_DIR }),
}))

vi.mock('@/hooks/miniapp-message-handler', () => ({
  handleMiniAppMessage: vi.fn(),
}))

vi.mock('@/components/miniapp/MiniAppIcon', () => ({
  MiniAppIcon: () => null,
}))

beforeEach(() => {
  resetChatState()
  ;(globalThis as unknown as { window: Window }).window.app = {
    trace: () => {},
  } as unknown as Window['app']
})

afterEach(() => {
  vi.restoreAllMocks()
})

function fireIframeReady(iframe: HTMLIFrameElement) {
  const event = new MessageEvent('message', {
    data: { type: 'miniapp-ready' },
    source: iframe.contentWindow,
  })
  window.dispatchEvent(event)
}

function renderBlock(toolUseId: string) {
  return render(
    <StandaloneToolBlock
      appId="demo-app"
      toolUseId={toolUseId}
      toolName="increment"
      appName="Demo App"
      toolReadableName="increment"
      args={{ by: 1 }}
      isStreaming={false}
      templatePath="increment-result.html"
    />,
  )
}

describe('StandaloneToolBlock dispatch lifecycle', () => {
  it('dispatches to iframe when callEntry arrives before miniapp-ready', () => {
    const toolUseId = 'toolu_entry_first'
    const { container } = renderBlock(toolUseId)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')

    // 1) callEntry arrives first (router-matched), iframe still loading.
    act(() => {
      setCallEntry(toolUseId, {
        callId: 'call-1', appId: 'demo-app', projectDir: PROJECT_DIR, toolName: 'increment', arguments: { by: 1 },
      })
    })
    expect(postMessageSpy).not.toHaveBeenCalled()

    // 2) iframe finishes loading and posts ready — dispatch should fire with entry.
    act(() => { fireIframeReady(iframe) })

    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'miniapp-standalone-call',
        callId: 'call-1',
        toolName: 'increment',
        arguments: { by: 1 },
      }),
      '*',
    )
  })

  it('regression: dispatches when miniapp-ready arrives BEFORE callEntry (stale-closure bug)', () => {
    const toolUseId = 'toolu_ready_first'
    const { container } = renderBlock(toolUseId)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')

    // 1) iframe ready FIRST — before router has matched.
    //    Before the fix, this captured `callEntry=undefined` into the listener closure,
    //    so the later callEntry update never triggered dispatch.
    act(() => { fireIframeReady(iframe) })
    expect(postMessageSpy).not.toHaveBeenCalled()

    // 2) Router matches and writes callEntry — dispatch should fire now.
    act(() => {
      setCallEntry(toolUseId, {
        callId: 'call-2', appId: 'demo-app', projectDir: PROJECT_DIR, toolName: 'increment', arguments: { by: 1 },
      })
    })

    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'miniapp-standalone-call',
        callId: 'call-2',
      }),
      '*',
    )
  })

  it('does not dispatch the same call twice', () => {
    const toolUseId = 'toolu_idempotent'
    const { container } = renderBlock(toolUseId)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')

    act(() => {
      setCallEntry(toolUseId, {
        callId: 'call-3', appId: 'demo-app', projectDir: PROJECT_DIR, toolName: 'increment', arguments: { by: 1 },
      })
    })
    act(() => { fireIframeReady(iframe) })
    expect(postMessageSpy).toHaveBeenCalledTimes(1)

    // Second ready (e.g. spurious re-emit) must NOT cause a second dispatch.
    act(() => { fireIframeReady(iframe) })
    expect(postMessageSpy).toHaveBeenCalledTimes(1)
  })

  it('replays the result via cached-result dispatch when result is already present', () => {
    const toolUseId = 'toolu_cached'
    const { container } = render(
      <StandaloneToolBlock
        appId="demo-app"
        toolUseId={toolUseId}
        toolName="increment"
        appName="Demo App"
        toolReadableName="increment"
        args={{ by: 1 }}
        result='{"ok":true,"previous":0,"value":1}'
        isStreaming={false}
        templatePath="increment-result.html"
      />,
    )
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage')

    // No callEntry — the call already completed. When iframe ready arrives,
    // the block should replay the cached result so the UI re-renders.
    act(() => { fireIframeReady(iframe) })

    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'miniapp-standalone-cached-result',
        callId: toolUseId,
        result: { ok: true, previous: 0, value: 1 },
      }),
      '*',
    )
  })
})
