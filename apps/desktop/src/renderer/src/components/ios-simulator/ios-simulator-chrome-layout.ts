import type { IosSimulatorChrome, IosSimulatorChromeButton } from '@superone/shared/ios-simulator'

export interface PointRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The full drawing area: the device plus the margin its buttons stick out into.
 *
 * Apple calls that margin `devicePadding`, and without it there is nowhere for a
 * button to show — which is exactly why the flat composite artwork, whose box stops
 * at the body, can never display one.
 */
export function iosSimulatorOuterBox(chrome: IosSimulatorChrome): { width: number; height: number } {
  return {
    width: chrome.width + chrome.padding.left + chrome.padding.right,
    height: chrome.height + chrome.padding.top + chrome.padding.bottom,
  }
}

/**
 * Where a physical button sits inside that area, in points.
 *
 * `across` positions the button's INNER edge inside the device, so the rest of its
 * width hangs out past the body — the smaller the value, the further it protrudes.
 * That is why Apple's hover offset counts *down* (8 → 3): the button slides out to
 * be clicked, it does not tuck in.
 *
 * `along` runs down (or across) the same edge and may be negative, which measures
 * from the far end instead; that is how an iPad's top button stays near the right
 * corner whatever the model is.
 */
export function iosSimulatorButtonRect(
  chrome: IosSimulatorChrome,
  button: IosSimulatorChromeButton,
  hovered = false,
): PointRect {
  const { across, along } = hovered ? button.hoverOffset : button.offset
  const { padding } = chrome
  const vertical = button.anchor === 'top' || button.anchor === 'bottom'
  const span = vertical ? chrome.width : chrome.height
  const size = vertical ? button.width : button.height
  const alongStart = along >= 0 ? along : span + along - size

  if (vertical) {
    return {
      x: padding.left + alongStart,
      y: button.anchor === 'top'
        ? padding.top + across - button.height
        : padding.top + chrome.height - across,
      width: button.width,
      height: button.height,
    }
  }
  return {
    x: button.anchor === 'left'
      ? padding.left + across - button.width
      : padding.left + chrome.width - across,
    y: padding.top + alongStart,
    width: button.width,
    height: button.height,
  }
}

export interface NineSlicePiece {
  key: keyof IosSimulatorChrome['slices']
  rect: PointRect
}

/**
 * The eight edge images laid out over the body, in points inside the outer box.
 *
 * The corner is clamped so a device smaller than two corners still draws something
 * sane instead of edges with negative width.
 */
export function iosSimulatorBodySlices(chrome: IosSimulatorChrome): NineSlicePiece[] {
  const { padding } = chrome
  const corner = Math.min(chrome.corner, chrome.width / 2, chrome.height / 2)
  const left = padding.left
  const top = padding.top
  const right = left + chrome.width - corner
  const bottom = top + chrome.height - corner
  const middleWidth = Math.max(0, chrome.width - corner * 2)
  const middleHeight = Math.max(0, chrome.height - corner * 2)
  return [
    { key: 'topLeft', rect: { x: left, y: top, width: corner, height: corner } },
    { key: 'top', rect: { x: left + corner, y: top, width: middleWidth, height: corner } },
    { key: 'topRight', rect: { x: right, y: top, width: corner, height: corner } },
    { key: 'left', rect: { x: left, y: top + corner, width: corner, height: middleHeight } },
    { key: 'right', rect: { x: right, y: top + corner, width: corner, height: middleHeight } },
    { key: 'bottomLeft', rect: { x: left, y: bottom, width: corner, height: corner } },
    { key: 'bottom', rect: { x: left + corner, y: bottom, width: middleWidth, height: corner } },
    { key: 'bottomRight', rect: { x: right, y: bottom, width: corner, height: corner } },
  ]
}

/**
 * The area the eight slices leave uncovered. It always falls inside the screen —
 * every corner is thicker than its frame — but the canvas is transparent until the
 * first frame lands, so it still wants a body-coloured fill under it.
 */
export function iosSimulatorBodyCenter(chrome: IosSimulatorChrome): PointRect {
  const corner = Math.min(chrome.corner, chrome.width / 2, chrome.height / 2)
  return {
    x: chrome.padding.left + corner,
    y: chrome.padding.top + corner,
    width: Math.max(0, chrome.width - corner * 2),
    height: Math.max(0, chrome.height - corner * 2),
  }
}

/** Point rect → the percentage style the panel actually draws with. */
export function iosSimulatorPercentRect(
  rect: PointRect,
  box: { width: number; height: number },
): { left: string; top: string; width: string; height: string } {
  return {
    left: `${(rect.x / box.width) * 100}%`,
    top: `${(rect.y / box.height) * 100}%`,
    width: `${(rect.width / box.width) * 100}%`,
    height: `${(rect.height / box.height) * 100}%`,
  }
}
