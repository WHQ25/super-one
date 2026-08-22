/** @vitest-environment jsdom */

import { forwardRef, useImperativeHandle } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StandaloneToolBlock } from './StandaloneToolBlock'

const send = vi.fn()
let webviewProps: Record<string, unknown> = {}

vi.mock('@/stores/app', () => ({
  useAppStore: <T,>(selector: (state: { currentProjectId: string; currentFolder: string }) => T) =>
    selector({ currentProjectId: 'project-id', currentFolder: '/project' }),
}))

vi.mock('@/hooks/use-is-dark', () => ({ useIsDark: () => false }))
vi.mock('@/hooks/miniapp-message-handler', () => ({ handleMiniAppMessage: vi.fn() }))
vi.mock('@/components/miniapp/miniapp-theme', () => ({ readThemeVars: () => ({ '--background': '#fff' }) }))
vi.mock('@/components/miniapp/MiniAppIcon', () => ({ MiniAppIcon: () => null }))
vi.mock('@/components/miniapp/MiniAppWebview', () => ({
  MiniAppWebview: forwardRef(function MockWebview(props: Record<string, unknown>, ref) {
    webviewProps = props
    useImperativeHandle(ref, () => ({ send, reload: vi.fn(), openDevTools: vi.fn() }))
    return <div data-testid="webview" />
  }),
}))

class VisibleIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    queueMicrotask(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never))
  }
  observe() {}
  disconnect() {}
}

function renderBlock(result?: string) {
  return render(
    <StandaloneToolBlock
      appId="demo-app"
      toolUseId="tool-1"
      toolName="increment"
      appName="Demo"
      toolReadableName="Increment"
      args={{ by: 2 }}
      result={result}
      isStreaming={false}
      templatePath="result.html"
    />,
  )
}

describe('StandaloneToolBlock WebView result lifecycle', () => {
  beforeEach(() => {
    send.mockReset()
    webviewProps = {}
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
    window.miniapp = {
      onHostMessage: () => () => {},
    } as unknown as Window['miniapp']
  })

  it('loads a standalone WebView and sends cached execution state after ready', () => {
    renderBlock('{"ok":true,"value":2}')

    expect(webviewProps.appId).toBe('demo-app')
    expect(webviewProps.src).toContain('superone-app://demo-app.project-id/result.html')
    expect(webviewProps.src).toContain('_standalone=1')

    act(() => {
      const onMessage = webviewProps.onMessage as (
        channel: string,
        data: Record<string, unknown>,
        sendMessage: (message: unknown) => void,
      ) => void
      onMessage('miniapp-ready', {}, send)
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'miniapp-theme' }))
    expect(send).toHaveBeenCalledWith({
      type: 'miniapp-standalone-data',
      arguments: { by: 2 },
      result: { ok: true, value: 2 },
      error: null,
    })
  })
})
