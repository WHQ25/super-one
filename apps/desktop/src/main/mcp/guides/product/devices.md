# Driving phones and tablets (`device_*`)

SuperOne can drive iOS Simulators and Android devices/emulators. One session may
hold several at once; every tool below except `device_list` and `device_boot`
needs a grant.

## The loop

```
device_list            → pick a device (free, boots nothing)
device_boot            → start it (free, grants nothing) — do this while you keep working
device_request_control → the user grants it; everything else fails with NO_DEVICE until then
device_snapshot        → a stateId + a tree of @eN refs
device_act             → act against that stateId, then re-observe
device_wait_for        → block on a condition instead of snapshotting in a loop
device_query           → re-read the snapshot you already have, with no device round trip
device_release         → let go when you are done — the close-tab of this loop
```

## Letting go

End every device task with `device_release`. A simulator nobody is driving is
still a simulator burning CPU, and the user should not have to notice the panel
to find out you left one running.

By default it puts the device back the way it was found: a simulator or emulator
SuperOne started is shut down; one the user already had running is left running
and merely unbound; a real phone is only ever disconnected. Pass
`shutdown: true` to stop a device that was running before you arrived — do that
when the user asked you to close it, not by habit. It has no effect on a real
phone, and the result says so.

The result reports `outcome: "shutdown" | "detached"` and whether the device is
still `running`. Either way this session no longer controls it: the other
`device_*` tools fail with `NO_DEVICE` until `device_request_control` grants it
again — instantly for a device left running, after a boot for one that was
shut down.

## Starting a device vs being allowed to drive it

These are two questions with two different answers, and they are two tools.

Turning a simulator on is no more privileged than running `xcrun simctl boot`
yourself, so `device_boot` needs no approval — call it as soon as you know which
device you want, then go build while it comes up. It grants nothing: the device
is running and nothing is driving it, and `device_snapshot` / `device_act` still
fail with `NO_DEVICE`.

Driving it is what the user answers. `device_request_control` raises a prompt and
waits. It offers two answers, and they differ in lifetime rather than in reach:
this chat only, or from now on for every session. A standing answer makes later
calls return immediately with no prompt; a different device still asks. The user
can take it back from the device tab's picker menu, so do not treat a device that
worked yesterday as guaranteed today.

Real phones (iPhone Mirroring, an attached Android handset) cannot be started
this way — they are already someone's running device. Call
`device_request_control` for those directly.

`device_list` is tiered on purpose: a dev machine holds over a hundred
simulators. No arguments returns what is running, what this project used before,
and which kinds exist; `kind` narrows to models; `model` narrows to one device
per runtime, with ids. Prefer a running or recent device — attaching is instant
while a cold boot costs about 20 seconds. Ids only matter when you need a
specific runtime: `device_request_control` also accepts a model name and picks
its newest.

## Refs, coordinates and OCR

`device_snapshot` in `mode: "semantic"` (the default) returns the accessibility
tree: `@eN` refs plus labels, identifiers and bounds. Prefer refs. They survive
animation and rotation; coordinates do not.

| Source | How it was read | How to act on it |
|---|---|---|
| accessibility tree | the app published it | `press(ref)` — resilient to animation |
| `(ocr)` | pixels, because that region publishes no tree (WebView, canvas) | `tap` — never `press` |

The reply says `source: "ocr"` or `"hybrid"` when any part was read from pixels.

`mode: "visual"` saves a PNG and returns `image.path` rather than pixels — Read
the file to look at it. `mode: "fused"` returns both, and degrades to whichever
half worked rather than failing.

Refs are positional and belong to exactly one snapshot. Re-snapshot after
anything that changes the screen; `device_act` rejects a stale `stateId` before
it causes any side effect.

## Settling

Captures wait for animation to stop. `settled: false` means the geometry is
approximate and the reply says so — re-snapshot before acting on coordinates.

Two platform differences worth knowing when a wait feels slow:

- **iOS** samples the tree and the pixels together every 150ms.
- **Android** cannot: `uiautomator dump` costs about 2.5s, so it settles on
  `screencap` (about 170ms, and byte-deterministic) and reads the tree once.

## `device_act`

1–10 actions run in order against one `stateId`. The whole batch and the
`stateId` are validated before any side effect, so an invalid batch changes
nothing.

`rotate` must be the last action in a batch, and the screen must be
re-snapshotted afterwards — rotation renumbers everything.

Set `recording: true` to save a short video containing only this transaction.

The result is `worked` / `didnt` / `unknown`. Pass `expect` to define what
success means, and the tool waits for it rather than guessing.

## Typing

`type` inserts at the cursor. `setText` replaces the field's whole value, and
`setText` with `text: ""` is how you clear one — typing an empty string is
refused, because doing nothing and reporting success reads as "the field is now
empty". Reach for `setText` whenever you mean "make this field say X"; `type`
into a field that already has content appends to it.

Both need something focused first. Tap the field in one action and type in the
next — the batch inserts a short settle between a tap and the typing after it,
and iOS additionally waits for the focus to land, but a field that never takes
focus fails rather than typing into nowhere.

Two things worth knowing when what arrives is not what you sent:

- **The guest's keyboard cannot eat your text, but it can eat keystrokes.** Text
  is delivered through a channel no input method sees — accessibility on iOS, the
  clipboard on Android — while Return, Tab and Backspace go as real keys so submit
  handlers fire. On iOS, a control that refuses to be written to falls back to
  keystrokes for everything, and on a guest set to a composing keyboard (Pinyin,
  Kana) that is reported as a failure naming the keyboard rather than silently
  mangled.
- **The device clipboard is borrowed, not taken.** Android types by pasting, and
  puts back whatever was on the clipboard afterwards.

`keyboard: {connected}` controls whether a hardware keyboard is *attached* — iOS
raises its on-screen keyboard only when a field has focus and none is. It has no
effect on which input method processes keys, so it will not fix mangled text.

## `device_wait_for`

Use it instead of a snapshot loop. It distinguishes `preexisting` (already true
when asked) from `verified` (became true while waiting), so a check that was
never going to fail is visible as such. On success it returns a fresh settled
`stateId` and the matching tree.

Target elements by `label` or `identifier`, never by `ref`: refs belong to one
snapshot, and the thing being waited for usually does not exist yet. `text` only
says what to compare — it never selects an element.

## Installing a build

After a grant, install and launch with the platform's own CLI, e.g.
`xcrun simctl install <udid> <path>.app` then `xcrun simctl launch <udid> <bundleId>`.


## Reusable app experience

Use `device_memory_read` / `device_memory_write` with the guest `platform` and
stable app bundle id/package name (`appId`). Experience is personal to the agent's
node, independent of which simulator or physical device hosts the app. It grants
no device control. Reuse procedures and stable identifiers, never stateId/@refs.
See `read_manual({domain:"product",topic:"memory"})` for revisions, OKF fields and deprecation.
