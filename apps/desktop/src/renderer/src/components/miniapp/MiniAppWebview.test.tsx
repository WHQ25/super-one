/** @vitest-environment jsdom */
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MiniAppWebview } from './MiniAppWebview'

vi.mock('@/stores/miniapp', () => ({ useMiniAppStore: (select: (state: { apps: unknown[] }) => unknown) => select({ apps: [] }) }))
vi.mock('@/stores/browser', () => ({ useBrowserStore: () => undefined }))
const open = vi.fn(), awaitResult = vi.fn(), cancel = vi.fn()
beforeEach(() => {
  open.mockReset().mockResolvedValue({ ok: true, requestId: 'form' })
  awaitResult.mockReset().mockReturnValue(new Promise(() => {}))
  cancel.mockReset().mockResolvedValue(undefined)
  Object.assign(window, { miniapp: { getPreloadPath: async () => '/preload.js' }, agent: { composerOpen: open, composerAwait: awaitResult, composerCancel: cancel } })
})

it('binds the guest to the trusted app/session and ignores subframe and same-document navigation', async () => {
  const { container } = render(<MiniAppWebview appId="demo" projectDir="/project" sessionId="owner" src="superone-app://demo/index.html" />)
  await waitFor(() => expect(container.querySelector('webview')).not.toBeNull())
  const view = container.querySelector('webview') as unknown as Electron.WebviewTag
  view.send = vi.fn().mockResolvedValue(undefined)
  act(() => view.dispatchEvent(new Event('dom-ready')))
  act(() => view.dispatchEvent(Object.assign(new Event('ipc-message'), { channel: 'composer-open', args: [{ id: 'call', spec: { title: 'Notes' }, sessionId: 'forged', appId: 'forged' }] })))
  await waitFor(() => expect(awaitResult).toHaveBeenCalledWith('form'))
  expect(open).toHaveBeenCalledExactlyOnceWith({ source: { kind: 'miniapp', appId: 'demo', projectDir: '/project', sessionId: 'owner' }, viewId: expect.any(String), localId: 'call', spec: { title: 'Notes' }, output: 'caller' })
  act(() => view.dispatchEvent(new Event('did-start-loading')))
  act(() => view.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: false, isInPlace: false })))
  act(() => view.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: true })))
  expect(cancel).not.toHaveBeenCalled()
  act(() => view.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: false })))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(view.send).toHaveBeenCalledWith('composer-result', { type: 'composer-result', id: 'call', outcome: { status: 'cancelled', reason: 'owner_disposed' } })
})
