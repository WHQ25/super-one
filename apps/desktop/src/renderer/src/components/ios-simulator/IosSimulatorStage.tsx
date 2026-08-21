import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Home, Keyboard, KeyboardOff, Loader2, LockKeyhole, Play, Plug, Power, RotateCcw, RotateCw, Smartphone, Unplug, Volume1, Volume2 } from 'lucide-react'
import type {
  IosSimulatorChrome,
  IosSimulatorChromeButton,
  IosSimulatorOrientation,
  IosSimulatorPreviewQuality,
  IosSimulatorDevice,
  IosSimulatorSessionState,
} from '@superone/shared/ios-simulator'
import {
  IOS_SIMULATOR_ROTATION_DEGREES,
  stepIosSimulatorOrientation,
} from '@superone/shared/ios-simulator'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { IosSimulatorBareScreen, iosSimulatorScreenAspect } from './IosSimulatorBareScreen'
import { IosSimulatorCaptureControls } from './IosSimulatorCaptureControls'
import { IosSimulatorPreviewMenu } from './IosSimulatorPreviewMenu'
import { IosSimulatorDeviceChrome } from './IosSimulatorDeviceChrome'
import { IosSimulatorDeviceMenu } from './IosSimulatorDeviceMenu'
import { IosSimulatorTouchPointer, useIosSimulatorTouchPointer } from './IosSimulatorTouchPointer'
import { classifyIosSimulatorFamily } from './ios-simulator-catalog'
import { readPreviewQuality, writePreviewQuality } from './ios-simulator-preview-quality'
import { attachIosSimulatorSurface } from './ios-simulator-surface'
import { useIosSimulatorInput } from './use-ios-simulator-input'

/** The keys a device body can carry, as both shells spell them. */
type HardwareButton = 'home' | 'lock' | 'side' | 'volume-up' | 'volume-down'

/**
 * Apple's shipped device artwork where the local Xcode has it, and the bare glass
 * where it does not. Nothing is drawn in between: a hand-made body would be a guess
 * at the one thing a real device is recognised by.
 */
function DeviceShell({
  chrome,
  family,
  ...shell
}: {
  chrome: IosSimulatorChrome | null
  family: Parameters<typeof IosSimulatorBareScreen>[0]['family']
  ref?: React.Ref<HTMLDivElement>
  onButton?: (button: HardwareButton) => void
  children: React.ReactNode
}) {
  if (chrome) return <IosSimulatorDeviceChrome chrome={chrome} {...shell} />
  const { onButton: _unused, ...rest } = shell
  return <IosSimulatorBareScreen family={family} {...rest} />
}

/**
 * The hardware keys the toolbar can offer, in the order a phone carries them.
 *
 * Apple's artwork makes most of these pressable on the body itself, so the toolbar
 * only draws the ones this device's shell does NOT already carry -- otherwise every
 * key would appear twice. It cannot be dropped outright: the drawn fallback shell's
 * side buttons are decoration, and most models ship no artwork at all (every iPad,
 * every Apple TV, iPhone 11-14, SE), so on those the toolbar is the only way in.
 * `home` in particular is never in the artwork -- chrome.json stopped listing it
 * once the home button stopped existing -- so it survives on every modern phone.
 */
const HARDWARE_KEYS = [
  { input: 'home', icon: Home, label: 'home' },
  { input: 'lock', icon: LockKeyhole, label: 'lock' },
  { input: 'volume-down', icon: Volume1, label: 'volumeDown' },
  { input: 'volume-up', icon: Volume2, label: 'volumeUp' },
] as const satisfies readonly {
  input: NonNullable<IosSimulatorChromeButton['input']>
  icon: typeof Home
  label: string
}[]

function deviceLabel(device: IosSimulatorDevice): string {
  return `${device.name} · ${device.runtimeName}`
}

/**
 * The glass, whenever the guest is not painting it: black, at the right proportions,
 * holding whatever the panel has to say. Drawing the body first and filling it second
 * is what keeps the panel from jumping between a line of centred text and a phone —
 * from the environment probe onward there is always a device on screen, it is just
 * not on yet.
 */
function DeviceScreen({ aspect, children }: { aspect?: number; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex max-h-full max-w-full flex-col items-center justify-center gap-3 bg-black text-center',
        // Mirrors the canvas it stands in for: the artwork shell hands over an exact
        // rect, the drawn shell takes its width from what sits in the glass.
        aspect ? 'h-full' : 'size-full',
      )}
      {...(aspect ? { style: { aspectRatio: aspect } } : {})}
    >
      {children}
    </div>
  )
}

/** Progress, on the glass. White at low alpha — `muted-foreground` vanishes on black. */
function GlassNote({ label }: { label?: string }) {
  return (
    <>
      <Loader2 className="size-7 animate-spin text-white/40" />
      {label && <span className="max-w-[80%] text-xs text-white/50">{label}</span>}
    </>
  )
}

function LaunchButton({
  booted,
  disabled,
  label,
  message,
  onLaunch,
}: {
  booted: boolean
  disabled: boolean
  label: string
  message: string | null
  onLaunch: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onLaunch}
        className={cn(
          'flex size-14 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white',
          'transition-colors hover:bg-white/25 disabled:pointer-events-none disabled:opacity-40',
        )}
      >
        {/* No optical nudge here: lucide's `Play` is already off-centre on purpose —
            its polygon runs 6→20 in a 24 box, so the glyph sits 1px right of the icon
            box, which is the correction a right-pointing triangle wants. Adding
            `translate-x-0.5` on top applied it twice, for a measured 3px drift. */}
        {booted ? <Plug className="size-6" /> : <Play className="size-6" />}
      </button>
      {message && <span className="max-w-[80%] text-xs text-white/50">{message}</span>}
    </>
  )
}

/** The same note, laid over a canvas that has not painted its first frame yet. */
function GlassOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
      <GlassNote label={label} />
    </div>
  )
}

interface IosSimulatorStageProps {
  sessionId: string
  /** The whole catalog, for the header's device menu. */
  devices: IosSimulatorDevice[]
  device: IosSimulatorDevice | null
  sessionState: IosSimulatorSessionState | null
  busy: boolean
  /** True while the local Xcode / simctl probe is still out, before any device is known. */
  checking: boolean
  /** True while a chosen device is booting, so the stage can say so instead of going blank. */
  launching: boolean
  /**
   * `preview` is the floating picture-in-picture: the device body and its glass, with
   * no header, no toolbar, no gutter and no input. Everything this drops is a control,
   * and the preview is not a place to operate the device from — it is a place to see
   * it from, which is why the box around it is the device's own outline.
   *
   * `overlay` is that preview expanded: the device becomes operable and the toolbar
   * comes back, but as a bar the width of the device rather than of the window, and
   * the header stays gone. What the header carried is management — pick a device,
   * change quality, disconnect, shut down — which belongs to the Activity panel; the
   * overlay is for working the device that is already in front of you.
   */
  variant?: 'panel' | 'preview' | 'overlay'
  /** Points the panel at another device. Draws it; does not start it. */
  onSelectDevice: (udid: string) => void
  /** Boots the drawn device, or attaches to it when it is already running. */
  onLaunchDevice: (udid: string) => void
  /** Closes the preview and leaves the simulator running. */
  onDetach: () => void
  /** Shuts the simulator down for real. */
  onTerminate: () => void
}

/**
 * The panel itself: the device menu in the header, the framebuffer canvas, the
 * hardware-button toolbar, and the input pipeline bound to them. It is the only view
 * — with nothing bound it shows the same menu over an empty stage rather than handing
 * off to a launcher page. Mounting opens the frame stream and unmounting closes it,
 * so a torn-down panel cannot leave a renderer drawing into a detached canvas.
 */
export function IosSimulatorStage({
  sessionId,
  devices,
  device,
  sessionState,
  busy,
  checking,
  launching,
  onSelectDevice,
  onLaunchDevice,
  onDetach,
  onTerminate,
  variant = 'panel',
}: IosSimulatorStageProps) {
  const { t } = useTranslation()
  const preview = variant === 'preview'
  const overlay = variant === 'overlay'
  const [hasFrame, setHasFrame] = useState(false)
  // Apple's own artwork for this exact model, when the local Xcode ships it — tagged
  // with the device it was read for, because WHICH device it describes is the whole
  // question. `chrome` below derives from it: `undefined` there means the lookup for
  // the device currently on screen has not answered, which is not the same as the
  // `null` that means this model ships no artwork.
  const [artwork, setArtwork] = useState<{ udid: string; chrome: IosSimulatorChrome | null } | null>(null)
  const [quality, setQuality] = useState<IosSimulatorPreviewQuality>(readPreviewQuality)
  const [orientation, setOrientation] = useState<IosSimulatorOrientation>('portrait')
  // The guest keeps a keyboard plugged or unplugged across a remount, and
  // CoreSimulator has a setter but no getter, so the host state IS the reading.
  const [keyboardConnected, setKeyboardConnected] = useState(true)
  const ready = sessionState?.phase === 'ready'
  // The preview is look-only, and the input pipeline has to know it: a hidden keyboard
  // sink that can still take focus, or a touch pointer drawn over a device nobody can
  // reach, are both worse than not wiring them up at all.
  const interactive = !preview && ready && sessionState?.interactive === true
  const rotationDegrees = IOS_SIMULATOR_ROTATION_DEGREES[orientation]
  // Handed over by `attachIosSimulatorSurface` below rather than created here: the
  // picture outlives this component, so the element is borrowed, not owned.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const { shellRef, sendInput, canvasHandlers, keyboard } = useIosSimulatorInput({
    sessionId,
    enabled: interactive,
    rotationDegrees,
    canvas,
  })
  const touchPointer = useIosSimulatorTouchPointer({
    enabled: interactive,
    rotationDegrees,
    handlers: canvasHandlers,
    canvas,
  })
  const udid = device?.udid ?? ''
  /**
   * Derived, not stored, so it can never describe the PREVIOUS device.
   *
   * Held as state, the answer for the device being left stayed on screen through the
   * first render of the next one. That is a real window, not a theoretical one: when
   * `bind` answers in the same batch that names the device — a warm simulator, or a
   * fast host — `ready` went true while `chrome` still held the last device's `null`,
   * so the canvas mounted inside the fallback shell, the stream opened against it,
   * and the artwork arriving a tick later swapped the shell, replaced the canvas, and
   * made main tear the helper's encoder down and renegotiate it. Comparing the udid
   * collapses that window to nothing and saves the extra render a reset effect cost.
   */
  const chrome = artwork?.udid === udid ? artwork.chrome : undefined
  // A generic phone silhouette stands in while there is no device to classify — the
  // environment probe runs before the list is even read.
  const family = device ? classifyIosSimulatorFamily(device) : 'iphone'
  // The canvas mounts only once the shell it hangs in is final. Under the fallback
  // body first and Apple's artwork second, it would be replaced — and a replaced
  // canvas costs a stream restart for a purely cosmetic upgrade.
  const live = ready && chrome !== undefined
  // Whether this session actually holds a device. A restored-but-shut-down simulator
  // is drawn and named without ever being bound, so `device` is the wrong test for
  // the two controls that give a binding back — and a stopped-but-still-bound device
  // is the wrong test for `ready`.
  const bound = Boolean(sessionState?.device)
  const takenByOther = Boolean(device?.boundSessionId && device.boundSessionId !== sessionId)
  const boundUdid = sessionState?.device?.udid ?? null

  /**
   * Adopt what the host already knows about the guest — how it is lying, and whether
   * it has a keyboard plugged in. Both are host-pushed state that survives a detach,
   * a rebind, or a panel remount, and CoreSimulator offers no getter for either.
   *
   * An effect rather than a `useState` seed: the panel mounts this stage with a null
   * session and fills it in once `bind` answers, so a seed only ever read the
   * defaults. That left a device the user had turned drawn upright with its
   * landscape picture lying on its side inside it.
   */
  useEffect(() => {
    if (!boundUdid || !sessionState) return
    setOrientation(sessionState.orientation)
    setKeyboardConnected(sessionState.hardwareKeyboardConnected)
    // Only when the bound device changes. Tracking `sessionState` itself would fight
    // the user: every list refresh would snap the device back off a fresh rotation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundUdid])

  /**
   * Follow the host once it starts changing these underneath us.
   *
   * The seed above deliberately fires only on a rebind, so it cannot carry a
   * rotation an agent performed while the panel was already open. Main pushes those
   * as they happen, and only as they happen, so adopting them here cannot fight a
   * rotation the user is in the middle of.
   */
  useEffect(() => {
    if (!boundUdid) return
    return window.environment.onIosSimulatorSessionState(sessionId, (state) => {
      setOrientation(state.orientation)
      setKeyboardConnected(state.hardwareKeyboardConnected)
    })
  }, [boundUdid, sessionId])

  /**
   * Take the session's decoded picture and put it in this view's host element.
   *
   * A layout effect, not an effect: the canvas is moved by `appendChild`, and doing
   * that after paint shows one frame of empty glass on every handover.
   *
   * `quality` and `udid` are dependencies because both are settled in `stream.start`
   * — but the registry renegotiates around the SAME canvas, so unlike the old effect
   * this no longer means the picture disappears while it happens.
   */
  useLayoutEffect(() => {
    const host = canvasHostRef.current
    if (!live || !host) return
    return attachIosSimulatorSurface(
      sessionId,
      host,
      { udid, quality, framed: chrome != null },
      setHasFrame,
      setCanvas,
    )
  }, [chrome, live, quality, sessionId, udid])

  // `chrome` is `undefined` while the artwork lookup is still out and `null` when
  // the model has none; both mean nothing is covered yet, so the toolbar stays whole.
  const shellInputs = useMemo(
    () => new Set((chrome?.buttons ?? []).map((button) => button.input).filter(Boolean)),
    [chrome],
  )

  /**
   * How wide the device is drawn, so the overlay's toolbar can be that wide too.
   *
   * `offsetWidth`, not `getBoundingClientRect()`: the shell is turned with a 300ms CSS
   * transform, and a rect read the moment the rotation is requested still describes the
   * old angle. The layout box ignores transforms, so swapping it by hand on a quarter
   * turn is both exact and immediate.
   *
   * The observer alone is not enough either — a quarter turn does change the layout box
   * (the wrapper swaps its container-query axes), but nothing tells it which way the
   * result is then rotated, which is what `rotationDegrees` is doing in the deps.
   */
  const [shellWidth, setShellWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!overlay) return
    const element = shellRef.current
    if (!element) return
    const measure = () => {
      const { offsetWidth, offsetHeight } = element
      setShellWidth(rotationDegrees % 180 === 0 ? offsetWidth : offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
    // `chrome` and `live` both swap the shell element out from under the ref.
  }, [overlay, rotationDegrees, chrome, live, shellRef])

  const rotate = useCallback((direction: 'left' | 'right') => {
    const next = stepIosSimulatorOrientation(orientation, direction)
    setOrientation(next)
    void sendInput({ type: 'rotate', orientation: next })
  }, [orientation, sendInput])

  // Unplugging the simulated hardware keyboard is the only way to raise the guest's
  // on-screen one -- iOS shows that exactly when a field has focus and no hardware
  // keyboard is attached. It costs host typing while it is up, which is the same
  // trade Simulator.app's Connect Hardware Keyboard makes.
  const toggleKeyboard = useCallback(() => {
    const next = !keyboardConnected
    setKeyboardConnected(next)
    void sendInput({ type: 'keyboard', connected: next })
  }, [keyboardConnected, sendInput])

  const changeQuality = useCallback((next: IosSimulatorPreviewQuality) => {
    setQuality(next)
    writePreviewQuality(next)
  }, [])

  useEffect(() => {
    // No device is its own settled answer: the empty stage draws the bare shell.
    if (!udid) { setArtwork({ udid: '', chrome: null }); return }
    let cancelled = false
    void window.environment.iosSimulatorChrome(udid)
      .then((next) => { if (!cancelled) setArtwork({ udid, chrome: next }) })
      // Missing artwork is not an error worth a toast — the CSS shell covers it.
      .catch(() => { if (!cancelled) setArtwork({ udid, chrome: null }) })
    return () => { cancelled = true }
  }, [udid])

  return (
    // Inherit the dockview group surface, do not repaint it.
    <div className={cn(
      'flex h-full min-h-0 flex-col',
      // The bar is a separate object under the device, not a strip welded to the
      // bottom edge of a panel, so it gets air above it and centres on the device.
      overlay && 'items-center gap-3 pb-4',
    )}>
      {variant === 'panel' && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {/* The device name IS the picker. There is no launcher page behind this panel
            any more, so the one label that always says which simulator you are looking
            at is also the one control that changes it. */}
        <IosSimulatorDeviceMenu
          sessionId={sessionId}
          devices={devices}
          currentUdid={device?.udid ?? ''}
          disabled={busy}
          onSelect={onSelectDevice}
        >
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start gap-1 px-2 font-medium"
          >
            <span className="min-w-0 truncate">
              {device ? deviceLabel(device) : t('activity.iosSimulator.picker.placeholder')}
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </IosSimulatorDeviceMenu>
        <IosSimulatorPreviewMenu
          quality={quality}
          nativeWidth={sessionState?.pixelWidth ?? 0}
          nativeHeight={sessionState?.pixelHeight ?? 0}
          disabled={busy || !ready}
          onChange={changeQuality}
        />
        {/* Both act on the binding, so neither has anything to do until there is one. */}
        <IconButton
          tooltip={t('activity.iosSimulator.detach')}
          onClick={onDetach}
          disabled={busy || !bound}
        >
          <Unplug />
        </IconButton>
        <IconButton
          tooltip={t('activity.iosSimulator.terminate')}
          variant="destructive"
          onClick={onTerminate}
          disabled={busy || !bound}
        >
          <Power />
        </IconButton>
      </div>}

      {/* Unpainted, like the header and the toolbar: the dockview group surface runs
          edge to edge behind all three, so the device sits on one continuous ground
          with only the two hairline rules dividing it.

          A size container so the device can be sized off both axes at once. Given only
          `height: 100%` plus `max-width`, a narrow panel clamps the width while the
          height stays put and the whole device — artwork and framebuffer — squashes
          sideways. Measured at 200px wide: 38% too narrow.

          Padding scales with the panel instead of sitting at a flat 1rem. The device
          fits to its shortest axis, so in a narrow panel that axis is the width and
          every padding pixel comes straight off the device — 32px of gutter is a
          rounding error at 900px and a sixth of the device at 200px. Percentages
          resolve against the panel's width on all four sides, and `min()` keeps the
          roomy 1rem once there is width to spend (from ~640px up). Container query
          units are not an option here: this element is itself the size container. */}
      <div
        className={cn(
          'relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden [container-type:size]',
          // The preview's box IS the device's outline, so a gutter there is not
          // breathing room — it is the amount by which the device fails to fill the
          // window the user sized for it.
          preview ? 'p-0' : 'p-[min(1rem,2.5%)]',
        )}
      >
        {!device && !checking && !launching ? (
          // Only reachable with nothing to restore — no session binding and no
          // remembered simulator. The one state with no device to draw a body for,
          // so it says so and offers the control the header already carries.
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            <span className="text-sm">{t('activity.iosSimulator.picker.placeholder')}</span>
            <IosSimulatorDeviceMenu
              sessionId={sessionId}
              devices={devices}
              currentUdid={udid}
              disabled={busy}
              onSelect={onSelectDevice}
            >
              <Button size="sm" variant="outline">
                <Smartphone data-icon />
                {t('activity.iosSimulator.picker.placeholder')}
              </Button>
            </IosSimulatorDeviceMenu>
          </div>
        ) : (
          // The shell is rotated as one piece, artwork and framebuffer together, so
          // the device reads as a physical object being turned rather than a picture
          // being reflowed. Swapping the box first is what keeps it fitting: a
          // quarter-turned device is bounded by the container's other axis, and this
          // wrapper is the size container the shell measures itself against.
          // Centred as well as sized: the shell fits itself to whichever axis runs
          // out first, so on the other axis it is smaller than this box and, left
          // to block flow, would sit against its top-left corner -- which the
          // rotation then throws into a different corner of the panel each turn.
          <div
            className="flex items-center justify-center [container-type:size] transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{
              width: rotationDegrees % 180 === 0 ? '100cqw' : '100cqh',
              height: rotationDegrees % 180 === 0 ? '100cqh' : '100cqw',
              transform: `rotate(${rotationDegrees}deg)`,
            }}
          >
            <DeviceShell
              ref={shellRef}
              // `undefined` means the artwork lookup is still out; draw the fallback
              // body meanwhile. Swapping it for Apple's a moment later is free while
              // the glass only holds a spinner — it is the CANVAS that must not be
              // replaced, which `live` below is what guards.
              chrome={chrome ?? null}
              family={family}
              {...(ready && !preview ? { onButton: (button: HardwareButton) => { void sendInput({ type: 'button', button }) } } : {})}
            >
              {live ? (
                <>
                  {/* Where the host keyboard actually lands. It has to be a real editable
                      element for macOS to run an input method against it, and it has to be
                      invisible without being `display: none` or `hidden`, because either
                      one makes it unfocusable. Kept at the device's own centre so the
                      macOS IME candidate window opens over the device rather than in a
                      corner of the panel. */}
                  <textarea
                    ref={keyboard.ref}
                    aria-label={t('activity.iosSimulator.keyboardInput')}
                    tabIndex={interactive ? 0 : -1}
                    readOnly={!interactive}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="pointer-events-none absolute left-1/2 top-1/2 size-px resize-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
                    {...keyboard.handlers}
                  />
                  {/* Where the session's canvas is parked while this view is the one
                      showing it. The element inside is created and owned by
                      `ios-simulator-surface`, so everything React still controls —
                      the fade-in, the cursor, the pointer handlers — lives out here
                      on the host instead. Sizing stays on the canvas itself, since
                      the drawn fallback shell measures itself against the picture. */}
                  <div
                    ref={canvasHostRef}
                    aria-label={device?.name ?? t('activity.iosSimulator.title')}
                    className={cn(
                      'flex max-h-full max-w-full items-center justify-center',
                      chrome ? 'h-full w-full' : 'h-full w-auto',
                      !hasFrame && 'opacity-0',
                      // The dot IS the cursor here — leaving the host arrow on top of it
                      // draws two pointers for one finger.
                      interactive && 'cursor-none touch-none',
                    )}
                    {...touchPointer.canvasHandlers}
                  />
                  {interactive && <IosSimulatorTouchPointer ref={touchPointer.ref} />}
                  {!hasFrame && <GlassOverlay label={t('activity.iosSimulator.waitingForFrame')} />}
                </>
              ) : (
                <DeviceScreen
                  // Apple's artwork hands the screen an exact rect; the drawn shell has
                  // no idea how wide the device is until a frame tells it, so before one
                  // exists the family's own proportions stand in.
                  {...(chrome ? {} : { aspect: iosSimulatorScreenAspect(family) })}
                >
                  {checking ? (
                    <GlassNote label={t('activity.iosSimulator.checking')} />
                  ) : launching ? (
                    <GlassNote label={t('activity.iosSimulator.picker.launching')} />
                  ) : !device || chrome === undefined ? (
                    // Between devices, or waiting on the artwork lookup. Both are
                    // sub-second and neither is worth a sentence.
                    <GlassNote />
                  ) : (
                    <LaunchButton
                      booted={device.booted}
                      disabled={busy || takenByOther}
                      message={takenByOther
                        ? t('activity.iosSimulator.picker.busy')
                        : sessionState?.message ?? null}
                      label={device.booted
                        ? t('activity.iosSimulator.picker.attach')
                        : t('activity.iosSimulator.picker.launch')}
                      onLaunch={() => onLaunchDevice(device.udid)}
                    />
                  )}
                </DeviceScreen>
              )}
            </DeviceShell>
          </div>
        )}
      </div>

      {/* Whatever the device body cannot be clicked for, plus rotation and capture.
          Always mounted, greyed until the guest can hear it: the bar is part of the
          panel's shape, and having it appear on boot moved the device up by its own
          height at the exact moment the user was watching the screen come on. */}
      {!preview && <div
        className={cn(
          'flex items-center justify-center gap-1',
          overlay
            // Never wraps. A wrapping bar would grow taller, shrink the device area,
            // narrow the device, narrow the bar, and wrap again — the width of this
            // bar is derived from a box whose height this bar takes away from.
            ? 'w-auto max-w-full shrink-0 flex-nowrap overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5 shadow-sm'
            : 'flex-wrap border-t px-3 py-2',
        )}
        {...(overlay && shellWidth ? { style: { width: shellWidth } } : {})}
      >
        {HARDWARE_KEYS.filter((key) => !shellInputs.has(key.input)).map(({ input, icon: Icon, label }) => (
          <IconButton
            key={input}
            tooltip={t(`activity.iosSimulator.${label}`)}
            disabled={!interactive}
            onClick={() => { void sendInput({ type: 'button', button: input }) }}
          >
            <Icon />
          </IconButton>
        ))}
        {/* Hidden rather than disabled where CoreSimulator has no such switch: a
            greyed-out key the user can never reach explains nothing. Before a device
            answers there is no such reading, and a key that only ever appears on some
            devices is better shown greyed than made to pop in on boot. */}
        {(!ready || sessionState?.hardwareKeyboardAvailable) && (
          <IconButton
            tooltip={t(`activity.iosSimulator.${keyboardConnected ? 'showSoftwareKeyboard' : 'hideSoftwareKeyboard'}`)}
            aria-pressed={!keyboardConnected}
            disabled={!interactive}
            onClick={toggleKeyboard}
          >
            {keyboardConnected ? <Keyboard /> : <KeyboardOff />}
          </IconButton>
        )}
        {/* Rotation reaches the guest through CoreSimulator's workspace port, not
            the HID client, so it stays available on a device whose HID refused. */}
        <IconButton
          tooltip={t('activity.iosSimulator.rotateLeft')}
          disabled={!ready}
          onClick={() => rotate('left')}
        >
          <RotateCcw />
        </IconButton>
        <IconButton
          tooltip={t('activity.iosSimulator.rotateRight')}
          disabled={!ready}
          onClick={() => rotate('right')}
        >
          <RotateCw />
        </IconButton>
        {/* Capture only needs the device booted, not interactive: `simctl io` reads
            the display without going through HID. */}
        <IosSimulatorCaptureControls sessionId={sessionId} disabled={!ready} />
      </div>}
    </div>
  )
}
