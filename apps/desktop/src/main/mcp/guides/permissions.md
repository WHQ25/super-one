# Permissions

Installation always requires approval for the trusted Node.js MiniApp Host. That host runs with the user's local account permissions and may access files, network, and processes.

`manifest.permissions` controls only browser-facing WebView network and media capabilities. It does not sandbox or grant capabilities to `manifest.main`.

## Network (`permissions.network`)

Adds domains to the WebView Content Security Policy:

```json
{
  "permissions": {
    "network": [
      { "domain": "api.example.com", "reason": "Fetch public data" },
      { "domain": "cdn.jsdelivr.net", "reason": "Load Chart.js" }
    ]
  }
}
```

The WebView still obeys browser CORS. A declared domain allows the request to leave but does not make a blocked response readable. Each WebView has a stable `superone-app://<appId>.<projectId>` origin.

Put server-to-server APIs, secret-bearing clients, and endpoints without CORS support in the trusted MiniApp Host. Node requests are not subject to WebView CSP or CORS.

## Browser storage

Every mini-app uses its own persistent Electron session partition and origin. `localStorage`, IndexedDB, Cache Storage, cookies, and related browser APIs work without a manifest permission and cannot be shared with another app's partition.

Authoritative application state belongs in `context.workspaceState` or `context.globalState` in the MiniApp Host. Larger data belongs under the corresponding storage path.

## Media (`permissions.media`)

Grants a WebView microphone or camera access:

```json
{
  "permissions": {
    "media": [
      { "kind": "microphone", "reason": "Voice dictation" },
      { "kind": "camera", "reason": "Capture photos" }
    ]
  }
}
```

Use standard browser APIs:

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
// Stop every track when finished.
stream.getTracks().forEach((track) => track.stop())
```

SuperOne shows a recording indicator while tracks are live. Device labels remain hidden until the first successful grant; listen for `devicechange` if devices can be connected at runtime.

Screen capture and system-audio loopback are not currently supported.

## Permission design

- Put privileged, non-UI work in the MiniApp Host and make the install trust boundary explicit.
- Declare the narrowest WebView domains and media kinds necessary.
- Never embed credentials or private keys in WebView assets.
- Treat `manifest.main` and all bundled Node dependencies as trusted local code during review.
