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
- `"readwrite"` — all read operations + `writeFile`, `deleteFile`, `trashFile`, `rename`, `mkdir`

Each entry requires a `reason` field — shown to the user during installation.

An app can declare multiple entries to access several directories. If no `fs` is declared, the app has no filesystem access.

When you declare scopes across more than one root (e.g. `project` + `app`), a **bare** path always means the **project** root. Reach the other scopes with an `@<scope>/` prefix — `@app/state.json`, `@user/.config/my-app/x`. See the `api-fs` topic → "Path Scopes".

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

### Calling APIs that don't return CORS headers

`permissions.network` only controls the CSP — it decides whether a request is **allowed to leave**. The browser still enforces **CORS** on the response: if the target server doesn't return an `Access-Control-Allow-Origin` header, the browser blocks your JS from reading the response even though the request succeeded. Declaring the domain does **not** override this.

Two things are SuperOne-specific and worth knowing when you configure a server's CORS:

- **The `Origin` your request carries** is `superone-app://<appId>.<projectId>` when the app declares `permissions.storage` (or `permissions.media`), and the literal string `null` otherwise (an opaque sandbox origin — see Storage below). For non-credentialed requests (Bearer token in `Authorization`, no cookies) a backend returning `Access-Control-Allow-Origin: *` works in both cases.
- **APIs designed for server-to-server use don't return CORS headers** — e.g. Google Vertex AI (`*-aiplatform.googleapis.com`), OAuth token endpoints (`oauth2.googleapis.com/token`), and most of `googleapis.com`. These cannot be called directly from a mini-app, and that is intentional: they authenticate with credentials (service-account private keys) that must **never** ship inside a sandboxed front-end. (APIs that do return CORS headers, like the Gemini Developer API `generativelanguage.googleapis.com`, work directly — just declare the domain.)

**Pattern for server-to-server APIs:** run your own backend, call the third-party API server-side (where there is no CORS and your credentials stay safe), return a CORS-enabled response to the mini-app, and declare `permissions.network` for **your own** domain. Do not attempt to embed cloud-provider credentials in the app to call these APIs directly.

## Storage (`permissions.storage`)

By default, mini-app iframes run with a `sandbox` that has no `allow-same-origin`, which makes them an opaque origin. On opaque origins the browser refuses every Web Storage API — `localStorage`, `sessionStorage`, `indexedDB.open(...)`, the Cache API, and `navigator.storage.*` all throw `SecurityError` (silently in some libraries).

Declare `permissions.storage` to add `allow-same-origin` to the iframe sandbox so these APIs work. Each mini-app is served from its own `superone-app://<appId>.<projectId>` origin, so storage is isolated per app — no app can read another app's data, and the host shell is on a different origin.

```json
{
  "permissions": {
    "storage": { "reason": "Persist user preferences and cached assets" }
  }
}
```

`storage` is a single object (not an array), with a required `reason` shown to the user during installation. There is no runtime API — once granted, use the standard Web Storage / IndexedDB / Cache APIs directly:

```js
localStorage.setItem('theme', 'dark')
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open('my-app', 1)
  req.onupgradeneeded = () => req.result.createObjectStore('kv')
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})
```

Use this when you want third-party libraries that quietly cache to storage to actually work (PDF.js, font loaders, request caches, etc.), or when your app needs to persist UI state across sessions without going through the `fs` bridge.

For larger or structured data that you want backed up with the project or shared across devices, prefer `permissions.fs` with `scope: "app"` instead — that data lives in `<appDir>/data/` and survives app rebuilds and pack/install cycles. Web Storage lives in the Chromium profile and can be cleared by browser-cache eviction.

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

## Background Worker (`permissions.background`)

Grants the app a headless background worker that keeps running after the panel is closed (long downloads, polling, queued uploads). Requires a `background.entry` HTML file in the manifest.

```json
{
  "background": { "entry": "background.html" },
  "permissions": {
    "background": { "reason": "Finish the download even when the panel is closed" }
  }
}
```

`background` is a single object (not an array), with a required `reason` shown to the user during installation. Without it, `superone.worker.start()` rejects. The worker inherits the app's other permissions (`fs`, `network`, `storage`, `media`) — declare those as usual if the worker needs them.

The worker is auto-reclaimed after 30 s idle (unless it holds a `superone.self.keepAlive` lease) and hard-capped at 6 h. Use the `api-worker` topic for the full API and lifecycle contract.

### What is *not* supported (yet)

- **Screen capture** (`getDisplayMedia()`) — needs Electron `desktopCapturer` plus a host-rendered source picker. Coming in a later release.
- **System audio loopback** — capturing the speaker output (e.g. for transcribing meetings). Needs platform-specific capture (ScreenCaptureKit on macOS, etc.).
- **Per-device-id permissions** — the manifest only declares `microphone` / `camera` at the kind level. Use `navigator.mediaDevices.enumerateDevices()` at runtime to let the user pick a specific device.
