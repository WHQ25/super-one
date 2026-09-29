# Device integration

### Device Platforms (iOS Simulator + Android)

Touch devices reach the app through **three seams**, each with a different audience.
Adding a platform means satisfying the three; nothing above them names a platform.

| Seam | File | Covers |
|---|---|---|
| `TouchDeviceBackend` | `main/device-agent/types.ts` | The AGENT driving a device it already holds — `observe` / `capture` / `perform` |
| `DevicePlatformPort` | `main/device/platform-port.ts` | Finding a device and being granted it — the catalog and the control prompt |
| `DeviceSurface` | `main/device/surface.ts` | A PERSON watching and touching — live frames and raw input |

They are separate because the audiences are: the agent takes one action and waits for
the screen to settle, while a person emits a hundred contact updates a second.

Platform-neutral code lives in `main/device/` (settle, tree reading, gesture synthesis,
perceptual hash, capture naming). Platform-specific code lives beside its backend —
`main/ios-simulator/` and `main/device/android/`. Anything only one platform can use
stays there: OCR fallback, DeviceKit artwork, runtime lists and simulator creation are
all iOS-only by nature, and giving Android an empty version would be a lie the UI then
has to check for.

`DeviceDescriptor` (`@superone/shared/device`) is the currency. Ids carry their
platform — `ios:<udid>`, `android:avd:<name>`, `android:<serial>` — so one string
routes to the right backend. Classification (`kind` / `model` / `versionRank` /
`kindRank`) is computed by the platform that owns the device and carried as data, which
is what lets one set of catalog tiers serve a model×runtime matrix and a list of AVDs
without either learning the other's vocabulary.

**Android registration is capability-gated, not flagged.** `detectAndroidToolchain()`
returns null when there is no SDK, the Android port is never constructed, and the
catalog output is byte-identical to before Android existed.

Two platform differences that are load-bearing rather than cosmetic:

- **Settling.** iOS samples tree + pixels together every 150ms. Android cannot:
  `uiautomator dump` costs 2.4–2.5s. It settles on `screencap` instead (170ms, and
  losslessly deterministic so equality needs no tolerance), then reads the tree once.
- **Rotation.** A simulator draws its rotated UI into a framebuffer that never changes
  shape, so the host turns the whole device as one rigid CSS rotation. Android
  re-shapes the framebuffer and scrcpy re-sends a session packet with the axes swapped
  — whatever draws it must RESIZE, not rotate.

The renderer consumes the neutral `device:*` IPC channels and `DeviceDescriptor`.
Shared panel, stream, input, PiP and catalog code lives under `components/device/`;
only simulator creation and DeviceKit artwork stay under `components/device/ios/`.
The stage uses `DEVICE_RIGID_ROTATION` to keep the iOS shell rotation model while
letting Android follow the dimensions published by scrcpy.

Live checks against a real device: `src/main/device/android/live.manual.test.ts`,
skipped unless `ANDROID_LIVE=1`. adb binds a daemon port, so it needs to run outside
the sandbox.

### Computer Use background input

macOS Computer Use drives apps without bringing them to the front. The helper
(`apps/desktop/native/computer-use-helper`) posts events to the target pid and makes
the app believe it is active (`SyntheticActivation.swift`); these facts shape it:

- **Chromium windows swallow the first click.** Web content refuses first mouse,
  so a click into a window that is not key only makes it key. The helper makes the
  window key first, at a point that is not replayed: the title label, the frame left
  of the close button when a hit-test says that point is the window itself, else an
  off-screen click for windows hosting an `AXWebArea`
  (`SyntheticActivation#keyMakingPoint`). Under a hidden title bar (Electron,
  Cursor) the strip beside the traffic lights is web content, so the frame point
  does not apply.
- **Menu commands in a background app need activation.** AppKit validates menus
  only for an active app with a key window. The helper presses the command under
  synthetic activation; if that fails it activates the app for real, presses, and
  hands the front back in the same call (`AxActions.swift#axPressMenuCommand`).
- **A focus-steal guard is required.** A driven app can activate itself for real
  (an Electron app opening a new `BrowserWindow`). `FocusStealGuard.swift` gives
  the front back when the app was driven in the last 3 s and no HID input arrived
  in the last 0.5 s; posted events do not count as HID, and activations the helper
  requests itself are registered first and left alone.
- **The window server picks a drag's drop target by real stacking order.** Posted
  pointer events reach a background window by number, but once the drag session
  starts the drop goes to the frontmost window at the drop point
  (`WindowCover.swift`). An exposed drop point lands in the background; under
  another app's window `main/computer-use/platform/macos-adapter.ts` asks the
  helper to activate the target around the drag and hand the front back; under
  SuperOne's own window only `computer_run` lowers that window
  (`main/jev/own-windows.ts`).
- **The host picks the delivery path per action.** `computer_act` has no delivery
  field. `macos-adapter.ts#applyOne` uses the AX action for press / select /
  open / setText, a ref's press capability for left clicks, a scroll bar's value
  for scrolls that have one, and events posted to the pid for everything else
  (right-clicks, coordinates, typing, keys, drags, wheel scrolls).
