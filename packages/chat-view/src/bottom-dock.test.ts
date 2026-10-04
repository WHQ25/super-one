// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const requestNative = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ requestNative }))
import { BottomDock } from './BottomDock'

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })

it('hands the keyboard back when the focused field leaves with its card', async () => {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const render = (card: boolean) => act(async () => root.render(createElement(BottomDock, null, card ? createElement('input') : null)))
  await render(true)
  await act(async () => container.querySelector('input')!.focus())
  expect(requestNative).toHaveBeenLastCalledWith('documentInputFocus', { focused: true })

  // Answered: the card goes away with the field still focused, so no focusout reaches the dock.
  await render(false)
  expect(requestNative).toHaveBeenLastCalledWith('documentInputFocus', { focused: false })
  expect(requestNative).toHaveBeenCalledTimes(2)

  await act(async () => root.unmount())
  container.remove()
})
