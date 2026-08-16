## Native UI

Every other module teaches you to *author* a visual. This one is the opposite: SuperOne renders one
of its own surfaces and you supply only the data. You write no HTML, no CSS, no layout.

Reach for this whenever the thing you want to show is **media you produced** — images or video from a
provider, a script, or adapter code you just wrote — rather than a layout you designed.

### Why not just build it in widget_code

A hand-built `<img>` grid is a picture of a gallery. The native one *is* the gallery, and carries
affordances a frame cannot reach:

- full-resolution viewer on click
- download, and drag straight out to Finder / Explorer
- the turn-end gallery grouping, so several generations in one turn collect into one strip
- correct behaviour on rescale, theme switch, and rerender — for free, and it stays correct as the
  host evolves

A widget cannot implement any of these, because they live outside the frame.

### Templates

| Template | Use for |
|---|---|
| `@native/image-gallery` | Generated or fetched **images** |
| `@native/video-gallery` | Generated or fetched **video** |

Call `widget_list_templates` for each one's exact `data` shape — that list is generated from the
running build, so it is authoritative and this page is not.

### Shape of a call

```js
widget_show({
  title: 'seedream results',
  template: '@native/image-gallery',
  data: {
    images: [
      { base64: '<raw bytes you fetched>', mediaType: 'image/png' },
      { path: '/abs/path/already-on-disk.png' },
    ],
    prompt: 'a cat on a bike',
    params: { provider: 'my-provider', model: 'seedream-4' },
  },
})
```

Each entry is either `{ path }` for a file that already exists, or `{ base64, mediaType }` for bytes
you are holding. The host writes the bytes to disk, generates thumbnails, and returns items
indistinguishable from a built-in generation. `prompt` and `params` are optional captions shown on
the card.

### What you will see

**The tool row disappears.** A native call is not narrated as "widget_show ran" — the gallery itself
takes its place in the transcript, exactly as it does for `media_generate_image`. That is intended:
the result is the UI.

If the call fails (a path that does not exist, an entry with neither `path` nor `base64`), the row
stays and reports the reason. Those errors are yours to fix — read the message and re-call.

### When NOT to use this

- You are laying out data, explaining something, or designing an interface → use `mockup`,
  `interactive`, `chart`, `diagram`, or `art`.
- You want to *style* images inside a larger composition you are designing → that is a normal widget.
- You want to show a single image inline in prose → plain markdown is lighter.

The test is simple: if you would otherwise write markup to arrange generated media, use a native
template. If you would write markup to express an idea, use the design modules.
