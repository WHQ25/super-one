# Driving phones and tablets (`device_*`)

SuperOne can drive iOS Simulators and Android devices/emulators. One session may
hold several at once; every tool below except `device_list` needs a grant.

## The loop

```
device_list            → pick a device (free, boots nothing)
device_request_control → the user grants it; everything else fails with NO_DEVICE until then
device_snapshot        → a stateId + a tree of @eN refs
device_act             → act against that stateId, then re-observe
device_wait_for        → block on a condition instead of snapshotting in a loop
device_query           → re-read the snapshot you already have, with no device round trip
```

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
