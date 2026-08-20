import { useState, type ReactNode, type Ref } from 'react'
import type { IosSimulatorChrome, IosSimulatorChromeButton } from '@superone/shared/ios-simulator'
import {
  iosSimulatorBodyCenter,
  iosSimulatorBodySlices,
  iosSimulatorButtonRect,
  iosSimulatorOuterBox,
  iosSimulatorPercentRect,
} from './ios-simulator-chrome-layout'

// Apple's own artwork, read from the local Xcode at runtime. Everything here is
// laid out in the device's point space and converted to percentages, so the device
// scales with the panel without a single hand-tuned pixel.
interface IosSimulatorDeviceChromeProps {
  chrome: IosSimulatorChrome
  ref?: Ref<HTMLDivElement>
  onButton?: (input: NonNullable<IosSimulatorChromeButton['input']>) => void
  children: ReactNode
}

export function IosSimulatorDeviceChrome({
  chrome,
  ref,
  onButton,
  children,
}: IosSimulatorDeviceChromeProps) {
  // Which button the pointer is over, and which is held down. Apple ships separate
  // artwork for both, so this is a picture swap rather than a CSS tint over a photo.
  const [hovered, setHovered] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const box = iosSimulatorOuterBox(chrome)
  const percent = (rect: Parameters<typeof iosSimulatorPercentRect>[0]) =>
    iosSimulatorPercentRect(rect, box)

  return (
    <div
      ref={ref}
      // No focus ring: the only focusable thing in here is the invisible keyboard
      // sink, and a rectangle drawn round the outer box cuts across Apple's body
      // artwork and its button margin. The caret belongs to the guest, which draws
      // its own, so the host ring was noise on every keystroke and button press.
      className="relative max-h-full max-w-full outline-none"
      style={{
        aspectRatio: `${box.width} / ${box.height}`,
        // Fit to whichever axis runs out first. `aspect-ratio` alone cannot do this:
        // clamping a definite height with `max-width` violates the ratio rather than
        // recomputing it, which is exactly how the device ends up squashed.
        width: `min(100cqw, calc(100cqh * ${box.width} / ${box.height}))`,
      }}
    >
      {/* Buttons go down FIRST, so the body covers the half of each that belongs
          inside the device and only the protruding sliver shows — Apple's own
          layering, and the reason the artwork ships as separate PDFs. */}
      {chrome.buttons.map((button) => {
        const isPressed = pressed === button.name
        return (
          <img
            key={`art-${button.name}`}
            src={isPressed && button.pressedImage ? button.pressedImage : button.image}
            alt=""
            draggable={false}
            aria-hidden
            className="pointer-events-none absolute select-none transition-[left,right,top,bottom] duration-150 ease-out motion-reduce:transition-none"
            style={percent(iosSimulatorButtonRect(chrome, button, hovered === button.name))}
          />
        )
      })}

      {/* A body-coloured floor under the part no slice reaches. Only visible before
          the first frame arrives, but a transparent hole there reads as a bug. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bg-black"
        style={percent(iosSimulatorBodyCenter(chrome))}
      />

      {iosSimulatorBodySlices(chrome).map(({ key, rect }) => (
        <img
          key={key}
          src={chrome.slices[key]}
          alt=""
          draggable={false}
          aria-hidden
          className="pointer-events-none absolute select-none"
          style={percent(rect)}
        />
      ))}

      <div
        className="absolute overflow-hidden"
        style={{
          ...percent({ ...chrome.screen, x: chrome.screen.x + chrome.padding.left, y: chrome.screen.y + chrome.padding.top }),
          // The framebuffer mask carries Apple's exact screen corner — no radius,
          // no squircle approximation, the shipped shape itself.
          maskImage: `url("${chrome.screenMask}")`,
          maskSize: '100% 100%',
          WebkitMaskImage: `url("${chrome.screenMask}")`,
          WebkitMaskSize: '100% 100%',
        }}
      >
        {children}
      </div>

      {/* Hit targets last, over the whole button including the part tucked under the
          body. The visible sliver is only a few points wide; asking the user to hit
          that would be worse than the toolbar they already have. */}
      {chrome.buttons.map((button) => {
        const input = button.input
        const rect = iosSimulatorButtonRect(chrome, button, hovered === button.name)
        return (
          <button
            key={`hit-${button.name}`}
            type="button"
            aria-label={button.title}
            title={button.title}
            // Apple draws an Action button that neither this panel nor Simulator.app
            // has any channel to press. It still belongs on the device; it just does
            // not pretend to be interactive.
            disabled={!input}
            style={percent(rect)}
            className="absolute cursor-pointer rounded-full outline-none disabled:pointer-events-none"
            onPointerEnter={() => setHovered(button.name)}
            onPointerLeave={() => { setHovered(null); setPressed(null) }}
            onPointerDown={() => setPressed(button.name)}
            onPointerUp={() => setPressed(null)}
            onPointerCancel={() => setPressed(null)}
            onFocus={() => setHovered(button.name)}
            onBlur={() => setHovered(null)}
            onClick={() => { if (input) onButton?.(input) }}
          />
        )
      })}
    </div>
  )
}
