/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  IOS_SIMULATOR_DEVICE as DEVICE,
  IOS_SIMULATOR_SESSION_ID as SESSION_ID,
  iosSimulatorRect,
  stubIosSimulatorEnvironment,
} from '../../../../test/fixtures/ios-simulator'
import { useChatStore } from '@/stores/chat'
import { useIosSimulatorPipStore } from '@/stores/ios-simulator-pip'
import { IosSimulatorPictureInPicture } from './IosSimulatorPictureInPicture'

/**
 * The preview alone, with no host layer behind it.
 *
 * It draws no device any more — `IosSimulatorHostLayer` does, over the hole this
 * measures out — so everything here is about the BOX: where it sits, how it is
 * grabbed, and the two buttons on it. The device's own survival across surfaces is
 * `IosSimulatorHostLayer.test.tsx`.
 */

/** The element the preview is pinned inside; jsdom reports zeros without this. */
function mountChatRoot() {
  const root = document.createElement('div')
  root.setAttribute('data-chat-root', '')
  root.getBoundingClientRect = () => iosSimulatorRect(0, 0, 1200, 800)
  document.body.appendChild(root)
}

async function renderPreview() {
  mountChatRoot()
  useChatStore.setState({
    activeProject: '/project',
    projectSessions: { '/project': { _activeSessionId: SESSION_ID } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useIosSimulatorPipStore.getState().setReady(SESSION_ID, {
    udid: DEVICE.udid, width: 1206, height: 2622,
  })
  const view = render(<IosSimulatorPictureInPicture />)
  // The box cannot be laid out until the chat root has been measured and the device's
  // artwork has answered with the outline to fit — so this is the first moment there
  // is a rect to make assertions about.
  await waitFor(() => expect(document.querySelector('[data-device-pip]')).not.toBeNull())
  return view
}

beforeEach(() => {
  document.body.innerHTML = ''
  stubIosSimulatorEnvironment()
  useIosSimulatorPipStore.setState({
    readySessionId: null, expandedSessionId: null, hiddenSessionId: null, device: null,
    slots: {}, pipSlots: {}, overlaySlots: {},
  })
})

describe('iOS Simulator preview box', () => {
  const pip = () => document.querySelector<HTMLElement>('[data-device-pip]')!
  const grip = (edge: string) =>
    document.querySelector<HTMLElement>(`[data-device-pip-resize="${edge}"]`)!

  /** Drag one handle by a delta and read the width it settled on. */
  function dragHandle(edge: string, dx: number, dy: number): number {
    fireEvent.pointerDown(grip(edge), { button: 0, clientX: 400, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 400 + dx, clientY: 400 + dy })
    const width = Number.parseFloat(pip().style.width)
    fireEvent.pointerUp(window)
    return width
  }

  it('offers a grip on every side as well as every corner', async () => {
    await renderPreview()

    // Corners alone were unreachable in practice: the device's body is a rounded
    // rect with a ~25%-of-width corner radius, so the box's corners are empty space
    // beyond the visible device. The sides meet the box exactly, so they are where
    // the pointer actually finds an edge.
    const offered = [...document.querySelectorAll('[data-device-pip-resize]')]
      .map((node) => node.getAttribute('data-device-pip-resize'))
    expect(new Set(offered)).toEqual(new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']))
  })

  it('reads only its own axis when the grip is a side', async () => {
    await renderPreview()
    const start = Number.parseFloat(pip().style.width)

    // Dragging the right edge horizontally is the whole point of a side grip.
    expect(dragHandle('e', 60, 0)).toBeGreaterThan(start)
    // ...and dragging it straight down must do nothing. A corner resolves a mostly
    // vertical drag into a width because it owns both axes; a side that did the same
    // would resize off the axis the hand is not on.
    expect(dragHandle('e', 0, 60)).toBe(Number.parseFloat(pip().style.width))
  })

  it('resizes from a top or bottom grip through the locked aspect', async () => {
    await renderPreview()
    const start = Number.parseFloat(pip().style.width)

    // The box is aspect-locked, so a vertical grip still has to produce a width —
    // it just has to come from the height rather than from the pointer's x.
    expect(dragHandle('s', 0, 80)).toBeGreaterThan(start)
  })

  it('opens the expanded overlay from a click that never became a drag', async () => {
    await renderPreview()

    const handle = document.querySelector('[data-device-pip-drag-handle]')!
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('swaps the measured slot from pip to overlay when it expands', async () => {
    await renderPreview()
    expect(document.querySelector('[data-ios-simulator-slot="pip"]')).not.toBeNull()

    act(() => { useIosSimulatorPipStore.getState().expandPreview(SESSION_ID) })
    await screen.findByRole('dialog')

    // One element, one key, one slot — the mode changes under it. Two branches would
    // unmount one hole and mount the other, and for the beat in between the host
    // layer would have nowhere at all to put the device.
    expect(document.querySelector('[data-ios-simulator-slot="pip"]')).toBeNull()
    expect(document.querySelector('[data-ios-simulator-slot="overlay"]')).not.toBeNull()
    expect(useIosSimulatorPipStore.getState().pipSlots[SESSION_ID]).toBeUndefined()
  })

  it('can be dismissed without expanding it first', async () => {
    await renderPreview()

    // The eye used to live only in the expanded overlay, so getting a phone off the
    // chat meant opening it up first.
    fireEvent.click(screen.getByLabelText('Hide device preview'))

    await waitFor(() => expect(document.querySelector('[data-device-pip]')).toBeNull())
    expect(useIosSimulatorPipStore.getState().hiddenSessionId).toBe(SESSION_ID)
  })
})
