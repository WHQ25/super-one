/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { IosSimulatorChrome } from '@superone/shared/ios-simulator'
import { IosSimulatorDeviceChrome } from './IosSimulatorDeviceChrome'

// Geometry taken from Apple's phone12 chrome, which the iPhone 17 Pro Max uses.
const CHROME: IosSimulatorChrome = {
  identifier: 'com.apple.dt.devicekit.chrome.phone12',
  slices: {
    topLeft: 'tl.png', top: 't.png', topRight: 'tr.png', right: 'r.png',
    bottomRight: 'br.png', bottom: 'b.png', bottomLeft: 'bl.png', left: 'l.png',
  },
  corner: 110,
  screenMask: 'mask.png',
  width: 476,
  height: 992,
  padding: { top: 0, left: 13, bottom: 0, right: 13 },
  screen: { x: 18, y: 18, width: 440, height: 956 },
  buttons: [
    {
      name: 'action', title: 'Action', anchor: 'left',
      offset: { across: 8, along: 180 }, hoverOffset: { across: 3, along: 180 },
      width: 16, height: 34, image: 'action.png',
    },
    {
      name: 'volume-up', title: 'Volume Up', anchor: 'left',
      offset: { across: 8, along: 268 }, hoverOffset: { across: 3, along: 268 },
      width: 16, height: 64, image: 'vol.png', pressedImage: 'vol-dn.png', input: 'volume-up',
    },
    {
      name: 'power', title: 'Power', anchor: 'right',
      offset: { across: 8, along: 293 }, hoverOffset: { across: 3, along: 293 },
      width: 16, height: 101, image: 'power.png', input: 'lock',
    },
  ],
}

function renderChrome(onButton = vi.fn()) {
  render(
    <IosSimulatorDeviceChrome chrome={CHROME} onButton={onButton}>
      <canvas data-testid="framebuffer" />
    </IosSimulatorDeviceChrome>,
  )
  return onButton
}

const artwork = (src: string) => document.querySelector<HTMLImageElement>(`img[src="${src}"]`)

describe('iOS Simulator device chrome buttons', () => {
  it('sends the hardware input for a side button drawn in the artwork', () => {
    const onButton = renderChrome()

    fireEvent.click(screen.getByRole('button', { name: 'Volume Up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Power' }))

    expect(onButton).toHaveBeenNthCalledWith(1, 'volume-up')
    // chrome.json calls it "power"; the helper's channel calls it "lock".
    expect(onButton).toHaveBeenNthCalledWith(2, 'lock')
  })

  it('draws every button Apple ships, including one nothing can press', () => {
    renderChrome()

    // The regression this guards: the panel used to render only the buttons it could
    // drive, so an iPhone's Action button vanished off a device that has one. Neither
    // this panel nor Simulator.app has a channel for it — that makes it inert, not
    // absent.
    expect(artwork('action.png')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Action' })).toBeDisabled()
  })

  it('draws the buttons beneath the body so only the protruding sliver shows', () => {
    renderChrome()

    // Apple ships these to be drawn under the body and slid out on hover, which the
    // flat composite could never do: it is opaque to within a point of its own edge,
    // with no margin for a button to appear in.
    const button = artwork('vol.png')!
    const bodyEdge = artwork('l.png')!
    expect(button.compareDocumentPosition(bodyEdge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('slides a hovered button further out from under the body', () => {
    renderChrome()

    const before = artwork('vol.png')!.style.left
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Volume Up' }))

    // 8 of its 16 points sat inside the body; hovering leaves only 3.
    expect(artwork('vol.png')!.style.left).not.toBe(before)
    expect(Number.parseFloat(artwork('vol.png')!.style.left))
      .toBeLessThan(Number.parseFloat(before))
  })

  it('swaps in Apple\'s pressed artwork while a button is held', () => {
    renderChrome()

    const target = screen.getByRole('button', { name: 'Volume Up' })
    fireEvent.pointerDown(target)
    expect(artwork('vol-dn.png')).not.toBeNull()

    fireEvent.pointerUp(target)
    expect(artwork('vol-dn.png')).toBeNull()
  })

  it('anchors each button to the edge its offset is measured from', () => {
    renderChrome()

    const box = CHROME.width + CHROME.padding.left + CHROME.padding.right
    // Device left edge is at 13; 8 of the button's 16 points sit inside it.
    expect(screen.getByRole('button', { name: 'Volume Up' }).style.left)
      .toBe(`${((13 + 8 - 16) / box) * 100}%`)
    // A right anchor mirrors onto the far edge rather than repeating the offset.
    expect(screen.getByRole('button', { name: 'Power' }).style.left)
      .toBe(`${((13 + 476 - 8) / box) * 100}%`)
  })
})
