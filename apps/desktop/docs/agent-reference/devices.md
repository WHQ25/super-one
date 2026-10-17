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
  A delivered iOS rotation updates the device's physical orientation even if the
  foreground app locks its content orientation. Keep that framebuffer unchanged and
  turn it with the shell; an app orientation lock is not an input error.

The renderer consumes the neutral `device:*` IPC channels and `DeviceDescriptor`.
Shared panel, stream, input, PiP and catalog code lives under `components/device/`;
only simulator creation and DeviceKit artwork stay under `components/device/ios/`.
The stage uses `DEVICE_RIGID_ROTATION` to keep the iOS shell rotation model while
letting Android follow the dimensions published by scrcpy.

### iOS foldable simulators (iPhone Duo)

The Duo device type declares two integrated displays in its `capabilities.plist`:
screen 1 is the cover (chrome `phone15`) and screen 3 the inner panel (`phone14`,
`nativeRotation` 270). It boots closed. Screen power does not follow the fold, so the
host tracks the hinge angle itself (`IosSimulatorManager`, closed on boot) and streams,
captures and touches the lit panel by screen id. The angle alone picks the form
(`iosSimulatorFoldAt`): 0° closed on the cover, up to 60° a tent on the cover, wider
open on the inner screen. The toolbar's hinge control is one 0-180° slider with those
stops marked; the emulator's posture ids stay as named stops for `device_configure`.
- **Tent** (posture 5, 60° by default) is not an angle to the guest, which reads any
  tent as half open; its angle is the host's, for the 3D body. SpringBoard lights the cover at a partial
  angle only under its tent policy, which keys on CoreMotion's tabletop pose
  `PartiallyOpenFaceDown`. The fold tool's `tent` mode sets it through
  `-[SBSTestAutomationService setDevicePoseOverride:]` (entitlement
  `com.apple.springboard.testautomation`) after the sweep, since every sweep resets
  the pose, and that sweep closes the device first. From closed the cover is already
  primary and the tent switch is `.nonAnimated`; from open it is a cover swap styled
  `.continuousLive`, which only hinge travel finishes, so it never ends and every later
  sweep is refused ("a display swap is already in flight") until an app launch drives
  it out. The guest swaps panels only when a sweep crosses its swap point, so a
  sweep out of a tent to an open angle would keep the cover lit; the manager closes
  first. The hinge runs down the cover's left edge, so a tent is also turned
  `landscape-right` to put it on top, whether or not the foreground app turns.
- **Orientation follows the form.** Changing between closed, tent and open turns the
  device to that form's hold (`FOLD_FORM_ORIENTATION`): closed and open upright, the
  open inner panel then landscape; a tent `landscape-right`. Within one form a hinge
  move keeps the user's turn.

- **Moving the hinge** is a guest call: SpringBoard's `SBSDisplayToolService`
  swap with `targetMode = 1` and an absolute position (0 closed, 0.5 = 90°, 1 open).
  The helper runs it through `Sources/Guest/FoldTool.m`, built for the simulator SDK
  with the `com.apple.springboard.sbdisplay.service` entitlement in a
  `__TEXT,__entitlements` section; a code-signature claim is refused at spawn. A zero
  duration takes an instant path that cannot leave a closed device, hence the sweep.
- **Touch** goes to `screenID | 0x40000000`, in framebuffer ratios.
- **Rotation**: the inner framebuffer is portrait under a landscape panel. The stage
  turns it by `fold.panelRotation` as one more rigid quarter turn.
- **Artwork**: both chromes ship placeholder nine-slices, so the composite is drawn,
  sized from its own box. `phone14` draws button art across its anchored edge; the
  loader turns such art a quarter.
- **3D** uses Xcode's skinned `V68.usdz` (DeviceKit's `CoreDevicePopDeviceKitExtension`)
  in place, nothing copied. Its `book_close` clip is scrubbed to the hinge angle, the lit
  glass is turned to the camera in each pose, and touches raycast the skinned glass by UV
  (`device-model-body.ts`). Apple maps the inner glass landscape, so the picture turns
  onto it and the stage does not.
- **Known gap**: accessibility returns one tree holding both panels' elements; agent
  observation on an unfolded device is not filtered per panel.

The helper encodes High profile with `constraint_set3_flag` set. VideoToolbox writes
no VUI, and without that flag Chromium's hardware decoder assumed a full DPB of
reordering and held pictures back: a still screen stayed black after a stream restart.

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
