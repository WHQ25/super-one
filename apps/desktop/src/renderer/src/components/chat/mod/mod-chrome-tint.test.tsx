/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import { ModChatThemeLayer } from './ModSurfaces'
import { getModChromeScheme, getModChromeTint, publishModChrome, resetModChromeTintForTests } from './mod-chrome-tint'
import { rememberModTheme, resetModThemeCacheForTests } from './mod-theme-cache'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function backdrop(props: Record<string, unknown>): ModBackdropSnapshot {
  return { result: { tree: { type: 'Box', props: {} }, props, hooked: true }, props: {} } as ModBackdropSnapshot
}

afterEach(() => {
  cleanup()
  resetModThemeCacheForTests()
  resetModChromeTintForTests()
  document.documentElement.classList.remove('dark')
})

describe('mod chrome tint', () => {
  it('keeps each session chrome separate', () => {
    publishModChrome('a', { tint: '#111111', scheme: 'light' })
    publishModChrome('b', { tint: '#222222', scheme: 'dark' })
    expect(getModChromeTint('a')).toBe('#111111')
    expect(getModChromeScheme('a')).toBe('light')
    expect(getModChromeTint('b')).toBe('#222222')
    expect(getModChromeScheme('b')).toBe('dark')
    expect(getModChromeTint('')).toBe('')
    publishModChrome('a', null)
    expect(getModChromeTint('a')).toBe('')
    expect(getModChromeTint('b')).toBe('#222222')
  })

  it('paints the remembered backdrop behind the shell before the session answers, without writing themeMode', async () => {
    const setTheme = vi.fn()
    Object.assign(window, { app: { setTheme } })
    document.documentElement.classList.add('dark')
    rememberModTheme({ sessionId: 's1', projectPath: '/repo' }, 'backdrop', backdrop({ id: 'bg', glass: { blur: 8, opacity: 0.4, tint: '#112233' } }))
    const view = render(
      <div data-main-area="">
        <div>Title</div>
        <ModChatThemeLayer sessionId="s1" projectPath="/repo" enabled>
          <div>pane</div>
        </ModChatThemeLayer>
      </div>,
    )
    await waitFor(() => expect(getModChromeTint('s1')).toBe('#112233'))
    expect(getModChromeScheme('s1')).toBe('dark')
    await waitFor(() => {
      expect(view.container.querySelector('[data-main-area] > [data-mod-site="Backdrop"]')).not.toBeNull()
    })
    expect(view.container.querySelector('[data-mod-theme-layer] > [data-mod-site="Backdrop"]')).toBeNull()

    view.rerender(
      <div data-main-area="">
        <ModChatThemeLayer sessionId="s1" projectPath="/repo" enabled={false}>
          <div>pane</div>
        </ModChatThemeLayer>
      </div>,
    )
    await waitFor(() => expect(getModChromeTint('s1')).toBe(''))
    expect(getModChromeScheme('s1')).toBe('')
    expect(setTheme).not.toHaveBeenCalled()
  })

  it('hides a dark theme while the window is light and asks the window for dark', async () => {
    rememberModTheme({ sessionId: 's1', projectPath: '/repo' }, 'backdrop', backdrop({ id: 'night', colorScheme: 'dark', glass: { blur: 8, opacity: 0.4, tint: '#112233' } }))
    const view = render(
      <div data-main-area="">
        <ModChatThemeLayer sessionId="s1" projectPath="/repo" enabled>
          <div>pane</div>
        </ModChatThemeLayer>
      </div>,
    )
    await waitFor(() => expect(getModChromeScheme('s1')).toBe('dark'))
    expect(view.container.querySelector('[data-mod-theme-layer]')).toBeNull()
    expect(view.container.querySelector('[data-mod-site="Backdrop"]')).toBeNull()
    expect(getModChromeTint('s1')).toBe('')
  })

  it('paints theme colors without a backdrop in the window appearance', async () => {
    rememberModTheme({ sessionId: 's1', projectPath: '/repo' }, 'theme', {
      colors: { light: { background: '#fafafa' }, dark: { background: '#101010' } },
    })
    const view = render(
      <ModChatThemeLayer sessionId="s1" projectPath="/repo" enabled>
        <div>pane</div>
      </ModChatThemeLayer>,
    )
    const layer = await waitFor(() => {
      const el = view.container.querySelector<HTMLElement>('[data-mod-theme-layer]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(layer.style.getPropertyValue('--background')).toBe('#fafafa')
    expect(getModChromeScheme('s1')).toBe('')
  })
})
