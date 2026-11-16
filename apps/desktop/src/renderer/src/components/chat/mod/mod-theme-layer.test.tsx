/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModUiClient, ModUiProvider, type ModUiTransport } from '@superone/chat-view/mod-ui'
import type { ModRenderResult, ModUiOp } from '@superone/shared/mod-ui'
import { ModChatThemeLayer } from './ModSurfaces'
import { resetModThemeCacheForTests } from './mod-theme-cache'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const UNHOOKED: ModRenderResult = { tree: { type: 'engine', ref: 0 }, props: {}, hooked: false }
const PORTS = { renderMarkdown: (t: string) => t, renderCode: ({ source }: { source: string }) => source, openLink: () => {}, renderLink: (_h: string, children: unknown) => children }

/** A live session whose mod answers the Theme and Backdrop sites. */
async function liveClient(answers: { Theme?: ModRenderResult; Backdrop?: ModRenderResult }): Promise<ModUiClient> {
  const transport = (async (op: ModUiOp, request: { component?: 'Theme' | 'Backdrop' }) => {
    if (op === 'attach') return { surfaces: ['desktop'] }
    if (op === 'panes') return { panes: [], shownId: null, focusedId: null, focusRequestedId: null }
    if (op === 'render') return (request.component && answers[request.component]) ?? UNHOOKED
    return {}
  }) as unknown as ModUiTransport
  const client = new ModUiClient({ transport, surface: 'desktop', clientId: 'test' })
  await client.attach()
  return client
}

function nightBackdrop(): ModRenderResult {
  return { tree: { type: 'Text', props: {}, children: ['night'] }, props: { id: 'night', overrideColorScheme: 'dark', glass: { blur: 8, opacity: 0.4 } }, hooked: true }
}

afterEach(() => {
  cleanup()
  resetModThemeCacheForTests()
  document.documentElement.classList.remove('dark')
})

describe('ModChatThemeLayer with a live session', () => {
  it('paints theme colors that come without a backdrop', async () => {
    const client = await liveClient({ Theme: { tree: { type: 'engine', ref: 0 }, props: { colors: { background: '#f6f1e7' } }, hooked: true } })
    const view = render(
      <ModUiProvider client={client} ports={PORTS as never}>
        <ModChatThemeLayer sessionId="s1" projectPath="/repo">
          <div>pane</div>
        </ModChatThemeLayer>
      </ModUiProvider>,
    )
    await waitFor(() => {
      const layer = view.container.querySelector<HTMLElement>('[data-mod-theme-layer]')
      expect(layer?.style.getPropertyValue('--background')).toBe('#f6f1e7')
    })
  })

  it('never writes the saved appearance and keeps an applied theme out of other projects', async () => {
    const setTheme = vi.fn(async () => {})
    Object.assign(window, { app: { ...(window as { app?: object }).app, setTheme, getTheme: async () => ({ mode: 'light', dark: false }) } })
    document.documentElement.classList.add('dark')
    const client = await liveClient({ Backdrop: nightBackdrop() })
    const view = render(
      <ModUiProvider client={client} ports={PORTS as never}>
        <ModChatThemeLayer sessionId="s1" projectPath="/repo">
          <div data-mod-placed-id="theme-card">
            <button type="button" data-mod-key="apply-night">Apply</button>
          </div>
        </ModChatThemeLayer>
      </ModUiProvider>,
    )
    await waitFor(() => expect(view.container.querySelector('[data-mod-backdrop="true"]')).not.toBeNull())
    await act(async () => view.container.querySelector<HTMLButtonElement>('[data-mod-key="apply-night"]')!.click())
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(setTheme).not.toHaveBeenCalled()
    view.unmount()

    const other = render(
      <ModChatThemeLayer sessionId="s2" projectPath="/elsewhere">
        <div>pane</div>
      </ModChatThemeLayer>,
    )
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(other.container.querySelector('[data-mod-backdrop="true"]')).toBeNull()
  })
})
