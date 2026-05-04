# Permissions

Mini-apps are sandboxed by default with no filesystem or network access. Add permissions in `manifest.json` to grant capabilities.

## File System (`permissions.fs`)

```json
{
  "permissions": {
    "fs": [
      { "scope": "project", "path": ".", "access": "readwrite", "reason": "Read and write project files" },
      { "scope": "project", "path": "src", "access": "read", "reason": "Analyze source code" },
      { "scope": "user", "path": ".config/my-app", "access": "readwrite", "reason": "Store user preferences" },
      { "scope": "app", "reason": "Persist app data between sessions" }
    ]
  }
}
```

### Scopes

| Scope | Resolves to | Requires |
|-------|------------|----------|
| `project` | `<projectDir>/<path>` | `path` + `access` |
| `user` | `~/<path>` | `path` + `access` |
| `app` | App's data directory (`<appDir>/data/`) | Nothing (always readwrite) |

### Access Levels

- `"read"` — `readFile`, `readDir`, `exists`, `glob`, `stat`, `watch`
- `"readwrite"` — all read operations + `writeFile`, `deleteFile`, `rename`, `mkdir`

Each entry requires a `reason` field — shown to the user during installation.

An app can declare multiple entries to access several directories. If no `fs` is declared, the app has no filesystem access.

Once declared, use the `api-fs` bridge API to read/write files.

## Network (`permissions.network`)

```json
{
  "permissions": {
    "network": [
      { "domain": "api.example.com", "reason": "Fetch data from API" },
      { "domain": "cdn.jsdelivr.net", "reason": "Load Chart.js library" }
    ]
  }
}
```

Whitelisted domains are added to the Content Security Policy (CSP) injected into the iframe. This affects **both** `fetch()` requests and `<script src="...">` tags — any domain not declared here will be blocked by the browser.

If a resource fails to load silently, check the browser console (DevTools) for CSP violation errors.

Use standard `fetch()` — no special bridge API needed:

```js
const res = await fetch('https://api.example.com/data')
```

### CDN Libraries

CDN libraries (Chart.js, D3, Three.js, Alpine.js, etc.) work great in vanilla apps. Add a `<script>` tag and declare the CDN domain:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

```json
{ "domain": "cdn.jsdelivr.net", "reason": "Load Chart.js" }
```

## Media (`permissions.media`)

Request access to the system microphone or camera. Each entry needs a `kind` and a `reason` (shown to the user during installation).

```json
{
  "permissions": {
    "media": [
      { "kind": "microphone", "reason": "Voice dictation" },
      { "kind": "camera",     "reason": "Capture photos for analysis" }
    ]
  }
}
```

Once granted, use the standard Web API — there is no bridge wrapper:

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
const recorder = new MediaRecorder(stream)
recorder.start()
// later: recorder.stop(); stream.getTracks().forEach(t => t.stop())
```

You can use `MediaRecorder`, `Web Audio API`, `<video>` elements, `enumerateDevices()`, etc.

### Selecting a specific device

The user may have multiple microphones / cameras (built-in mic, USB mic, virtual webcam, …). Let them pick which one to use with `navigator.mediaDevices.enumerateDevices()`:

```js
const devices = await navigator.mediaDevices.enumerateDevices()
const mics = devices.filter((d) => d.kind === 'audioinput')
const cams = devices.filter((d) => d.kind === 'videoinput')

// Render mics/cams in a <select>; on change:
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { deviceId: { exact: selectedMicId } },
  video: false,
})
```

Two gotchas:

1. **Labels are hidden until access is granted.** Before the first successful `getUserMedia` call, every `device.label` is an empty string (Chromium privacy default). Show "Microphone 1 / Microphone 2" placeholders, then re-enumerate after the first stream is acquired to reveal real names.
2. **Devices change at runtime.** Listen for `devicechange` to update your selector when the user plugs in a USB mic or unplugs a Bluetooth headset:

```js
navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
```

### Recording indicator

Whenever any mini-app holds a live audio or video track, a red pulsing pill appears in the host title bar showing how many apps are recording. Clicking it lists each app and the kinds of streams it currently has open. The indicator clears automatically when every track stops (`track.stop()` or natural end).

Be a good citizen: stop tracks as soon as you don't need them, otherwise the red dot stays on and users will revoke trust.

### What is *not* supported (yet)

- **Screen capture** (`getDisplayMedia()`) — needs Electron `desktopCapturer` plus a host-rendered source picker. Coming in a later release.
- **System audio loopback** — capturing the speaker output (e.g. for transcribing meetings). Needs platform-specific capture (ScreenCaptureKit on macOS, etc.).
- **Per-device-id permissions** — the manifest only declares `microphone` / `camera` at the kind level. Use `navigator.mediaDevices.enumerateDevices()` at runtime to let the user pick a specific device.
