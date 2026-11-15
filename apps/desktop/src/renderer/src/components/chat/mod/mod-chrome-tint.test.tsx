/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModChatThemeLayer } from './ModSurfaces'
import { getModChromeScheme, getModChromeTint, publishModChromeTint, resetModChromeTintForTests } from './mod-chrome-tint'
import { resetModThemeCacheForTests, writeModTheme } from './mod-theme-cache'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  cleanup()
  resetModThemeCacheForTests()
  resetModChromeTintForTests()
})

describe('mod chrome tint', () => {
  it('keeps each session tint separate', () => {
    publishModChromeTint('a', '#111111', 'light')
    publishModChromeTint('b', '#222222', 'dark')
    expect(getModChromeTint('a')).toBe('#111111')
    expect(getModChromeScheme('a')).toBe('light')
    expect(getModChromeTint('b')).toBe('#222222')
    expect(getModChromeScheme('b')).toBe('dark')
    expect(getModChromeTint('')).toBe('')
    publishModChromeTint('a', null)
    expect(getModChromeTint('a')).toBe('')
    expect(getModChromeTint('b')).toBe('#222222')
  })

  it('publishes the session backdrop tint and does not write themeMode', async () => {
    const setTheme = vi.fn()
    Object.assign(window, { app: { setTheme } })
    document.documentElement.classList.add('dark')
    writeModTheme({
      scope: 'session',
      sessionId: 's1',
      projectPath: '/repo',
      folderPath: '/repo',
      backdrop: {
        result: {
          tree: { type: 'engine', ref: 0 },
          props: { id: 'bg', glass: { blur: 8, opacity: 0.4, tint: '#112233' } },
          hooked: true,
        },
        props: {},
      },
    })
    const view = render(
      <ModChatThemeLayer sessionId="s1" projectPath="/repo" folderPath="/repo" enabled>
        <div>pane</div>
      </ModChatThemeLayer>,
    )
    await waitFor(() => expect(getModChromeTint('s1')).toBe('#112233'))
    expect(setTheme).not.toHaveBeenCalled()

    const shell = render(
      <div data-main-area="">
        <div>Title</div>
        <ModChatThemeLayer sessionId="s1" projectPath="/repo" folderPath="/repo" enabled>
          <div>pane</div>
        </ModChatThemeLayer>
      </div>,
    )
    await waitFor(() => {
      const host = shell.container.querySelector('[data-main-area]')
      expect(host?.querySelector(':scope > [data-mod-site="Backdrop"]')).not.toBeNull()
    })
    expect(shell.container.querySelector('[data-mod-theme-layer] > [data-mod-site="Backdrop"]')).toBeNull()

    view.rerender(
      <ModChatThemeLayer sessionId="s1" projectPath="/repo" folderPath="/repo" enabled={false}>
        <div>pane</div>
      </ModChatThemeLayer>,
    )
    await waitFor(() => expect(getModChromeTint('s1')).toBe(''))
    expect(setTheme).not.toHaveBeenCalled()
    expect(getModChromeTint('other')).toBe('')
    document.documentElement.classList.remove('dark')
  })

  it('does not paint a dark theme while the window is light', async () => {
    document.documentElement.classList.remove('dark')
    writeModTheme({
      scope: 'session',
      sessionId: 's1',
      projectPath: '/repo',
      folderPath: '/repo',
      backdrop: {
        result: {
          tree: { type: 'engine', ref: 0 },
          props: { id: 'night', colorScheme: 'dark', glass: { blur: 8, opacity: 0.4, tint: '#112233' } },
          hooked: true,
        },
        props: {},
      },
    })
    const view = render(
      <div data-main-area="">
        <ModChatThemeLayer sessionId="s1" projectPath="/repo" folderPath="/repo" enabled>
          <div>pane</div>
        </ModChatThemeLayer>
      </div>,
    )
    await waitFor(() => expect(view.container.querySelector('[data-mod-theme-layer]')).toBeNull())
    expect(view.container.querySelector('[data-main-area] > [data-mod-site="Backdrop"]')).toBeNull()
    expect(getModChromeTint('s1')).toBe('')
  })
})
