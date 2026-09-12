# Show your work

When you verify something the user cannot see from their chair — a screen on a
simulator, a page in the embedded browser, a window under computer use — the
verification is only as good as what you show of it. "Confirmed on the
simulator" is a claim. A screenshot of the simulator is evidence. This chapter is
how to turn the second into the default.

Everything here uses tools you already have. Each returns an absolute file
path; the field depends on the tool:

| Call | Path field |
|------|-----------|
| `device_snapshot({ mode: "visual" })` or `"fused"` | `image.path` |
| `device_act({ …, recording: true })` | `recording.savedPath` |
| `browser_snapshot({ include: ["screenshot"] })` | `path` |
| `browser_snapshot({ include: ["meta", "screenshot"] })` | `screenshot.path` |
| `computer_snapshot({ mode: "visual" })` or `"fused"` | `image.path` |

Two things to know before relying on the table. `browser_snapshot` returns no
picture unless `"screenshot"` is in `include` — its default is meta, elements
and console. And `device_act` recording works on iOS Simulator and Android
only; iPhone Mirroring takes screenshots but cannot record.

The chat renders a returned path when you embed it:

```markdown
![Drawer open, active project already expanded](</var/folders/xx/T/super-one-captures/ios-simulator/shot.png>)
![Tap on design-system → spinner → rows unfold](</var/folders/xx/T/super-one-recordings/device/clip.mp4>)
```

Always wrap the path in angle brackets. Some capture directories contain spaces
or parentheses, and a bare path with either is not valid Markdown — the user
sees literal text instead of the picture. Use the path the tool returned, never
one you reconstructed.

## What to capture

**A still, for a state.** A layout, a colour, a label, something present or
absent. Take it after the state you are proving has arrived — a spinner that
clears in a second is not in a snapshot taken two seconds later. On a device,
`device_snapshot` waits for animation to stop and reports `settled`; in the
browser and on the desktop nothing waits for you, so wait for the target state
explicitly (`browser_wait_for`, a `computer_snapshot` after the transition)
before taking the picture. Crop or point: if the claim is about one row, say
which row, or take the snapshot with the row near the top.

**A recording, for a change.** Anything that moves, loads, transitions or
appears in sequence needs the before, the transition and the after; a still of
only the after proves nothing about the animation. `device_act` with
`recording: true` films exactly that one batch, with a second of the starting
screen in front and a second after the batch's own settle and `expect` wait.
Put the whole gesture in the batch, get the screen into its starting state with
unrecorded calls first, and pick `expect` for the *finished* state so the tail
begins when the motion has ended, not when it began. The batch also returns
when `expect` times out or the screen never settles, and the tail runs anyway —
so read `outcome`, `expectMet` and `settled` on the result, and look at the
clip. One that ends mid-transition or starts already changed is a reason to
record again, not a reason to describe what the viewer should have seen.

**Before and after, for a fix.** If the point is "this used to jitter and now
it does not", show both sides when you can, or show the after and say precisely
what would have been different before.

## What to show

- Embed the file in the reply that reports the result, not in a later one, and
  put it next to the claim it supports. One file at most once per reply.
- Say what to look at. A screenshot of a full phone screen has a hundred things
  on it; the sentence under it names the one that matters ("the spinner sits in
  the folder icon's slot; the rows below have not moved").
- Do not claim what the frame does not show. If the recording cut off before
  the state settled, say so and record again. A crop or contact sheet you built
  from frames is fine, but say that it is one, and keep the original clip
  embedded too.
- Videos take a second to watch and a still takes none: when a recording is the
  evidence, consider adding one extracted frame for the moment that matters, and
  let the video carry the motion.
- Stop when the evidence is shown. The user asked whether it works, not for a
  tour of the tool.

## What not to show

The user's own media — photos, screenshots and videos already in their project
or on their disk — is theirs to ask for. Link it (`[name](</abs/path>)`) unless
they asked to see or play it. Media produced by SuperOne's generation tools is
displayed automatically; do not embed it a second time.

## Leave it as you found it

Evidence is the first half of finishing; the second is not leaving the surface
in a state the user has to clean up. Before ending a task:

| Surface | Close what you opened | Keep what you found |
|---------|----------------------|---------------------|
| Browser | `browser_tabs({ action: "close", tab: [...] })` for tabs you opened and no longer need | A tab that was open before you started, or one the user is reading now (a preview you opened for them counts), stays open |
| Device | `device_release` at the end of every device task | Its default shuts down a simulator SuperOne booted and only unbinds one the user already had running |
| Desktop app | Quit an app you launched, the way a user would: the app's own quit (`osascript -e 'quit app "Name"'` on macOS, or its quit shortcut through `computer_act`). No SuperOne tool is needed. | An app that was already running (`computer_apps` listed it `running` before you launched anything) stays running. Never kill by process name (`pkill`, `taskkill /IM`): that takes every instance with it, the user's included, and skips the app's save prompts |

Do it after the evidence is captured, not before — a screenshot of a closed tab
proves nothing — and say in one line what you closed.

## Where files live

Screenshots and recordings are written under the OS temp directory
(`super-one-captures/…` and `super-one-recordings/…`) and nothing but the OS
ever prunes them: fine to embed in the reply you are writing now, not a place
to link from a note that will be read next month. Nothing needs to be copied
into the project to embed one. If the user wants a piece of evidence kept with
the work — for a PR, a handoff, a design note — copy it somewhere gitignored
and link that copy; screenshots and videos do not belong in git.
