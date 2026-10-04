/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModUiClient, ModUiProvider, type ModUiTransport } from '@superone/chat-view/mod-ui'
import type { ModElement, ModPaneRoster, ModUiOp } from '@superone/shared/mod-ui'
import { ModAbovePrompt } from './ModSurfaces'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const BAND: ModElement = {
  type: 'Box',
  props: { flexDirection: 'row' },
  children: [{ type: 'Button', props: { key: 'go', label: 'Go', hotkey: '1' }, press: { plugin: 'p', handle: 1 } } as ModElement],
}

const NO_PANES: ModPaneRoster = { panes: [], shownId: null, focusedId: null, focusRequestedId: null }
const ONE_PANE: ModPaneRoster = { panes: [{ id: 'pane', title: 'Pane', plugin: 'p' }], shownId: 'pane', focusedId: null, focusRequestedId: null }

const pressed = vi.fn()

function client(roster: ModPaneRoster): ModUiClient {
  const transport = (async (op: ModUiOp, request: { component?: string }) => {
    if (op === 'attach') return { surfaces: ['desktop'] }
    if (op === 'panes') return roster
    if (op === 'render') return request.component === 'AbovePrompt' ? { tree: BAND, props: {}, hooked: true } : { tree: { type: 'Text', props: {}, children: ['pane'] }, props: {}, hooked: true }
    if (op === 'press') pressed()
    return { handled: true }
  }) as unknown as ModUiTransport
  return new ModUiClient({ transport, surface: 'desktop', clientId: 'test' })
}

async function mount(roster: ModPaneRoster, isEmpty: () => boolean = () => true) {
  const c = client(roster)
  await c.attach()
  render(
    <ModUiProvider client={c} ports={{ renderMarkdown: (t) => t, renderCode: ({ source }) => source, openLink: () => {}, renderLink: (_h, children) => children }}>
      <div>
        <ModAbovePrompt isWorking={false} sessionId="s1" isComposerEmpty={isEmpty} />
        <div contentEditable data-chat-input-editor="true" data-testid="composer" />
      </div>
    </ModUiProvider>,
  )
  await waitFor(() => expect(document.querySelector('[data-mod-hotkey="1"]')).not.toBeNull())
  return screen.getByTestId('composer')
}

function key(target: HTMLElement, init: KeyboardEventInit): { event: KeyboardEvent; reachedWindow: boolean } {
  let reachedWindow = false
  const late = () => { reachedWindow = true }
  window.addEventListener('keydown', late)
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  window.removeEventListener('keydown', late)
  return { event, reachedWindow }
}

function setPlatform(platform: string) {
  Object.assign(window, { app: { platform } })
}

beforeEach(() => {
  pressed.mockClear()
  setPlatform('darwin')
})

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

describe('mod composer keys', () => {
  it('presses the band button for a digit from an empty composer, and nothing after sees the key', async () => {
    const composer = await mount(NO_PANES)
    const { event, reachedWindow } = key(composer, { key: '1' })
    expect(event.defaultPrevented).toBe(true)
    expect(reachedWindow).toBe(false)
    await waitFor(() => expect(pressed).toHaveBeenCalledTimes(1))
  })

  it('leaves digits alone when the draft is not empty', async () => {
    const composer = await mount(NO_PANES, () => false)
    const { event, reachedWindow } = key(composer, { key: '1' })
    expect(event.defaultPrevented).toBe(false)
    expect(reachedWindow).toBe(true)
  })

  it('does not take Ctrl+X when there is no pane to move to', async () => {
    const composer = await mount(NO_PANES)
    expect(key(composer, { key: 'x', ctrlKey: true }).event.defaultPrevented).toBe(false)
  })

  it('takes Ctrl+X Tab into the pane above the composer', async () => {
    const composer = await mount(ONE_PANE)
    expect(key(composer, { key: 'x', ctrlKey: true }).event.defaultPrevented).toBe(true)
    expect(key(composer, { key: 'Tab' }).event.defaultPrevented).toBe(true)
    expect(document.activeElement?.closest('[data-mod-site="Pane"]')).not.toBeNull()
  })

  it('leaves Ctrl+X to Cut over a selection off macOS', async () => {
    setPlatform('win32')
    const composer = await mount(ONE_PANE)
    composer.textContent = 'cut me'
    window.getSelection()!.selectAllChildren(composer)
    expect(key(composer, { key: 'x', ctrlKey: true }).event.defaultPrevented).toBe(false)
    window.getSelection()!.removeAllRanges()
    expect(key(composer, { key: 'x', ctrlKey: true }).event.defaultPrevented).toBe(true)
  })
})
