# context.host — System & Clipboard

Node-side. Available on the `context` passed to `activate()` in `manifest.main`.

These are the host actions that need no DOM coordinates, so they belong to the
MiniApp Host and work with no WebView mounted — a background sync can notify the
user or reveal its output on its own. Anchored surfaces (tooltip, context menu,
popover, drag) stay in the WebView; see `api-ui`.

## host.toast

```js
await context.host.toast('Sync finished', 'success')
await context.host.toast('Something went wrong', 'error')
await context.host.toast('Be careful', 'warning')
await context.host.toast('FYI')                    // 'info' is the default
```

## host.revealInFolder

Reveals a path in Finder / Explorer. The path must be absolute and inside the
app's own scope — the open project, the app directory, or its storage dirs.

```js
await context.host.revealInFolder(context.workspace.rootPath)
```

## host.openExternal

Opens an `http(s)` URL in the system browser. SuperOne shows a confirm dialog
first; the promise resolves once the request is handed off.

```js
await context.host.openExternal('https://docs.example.com')
```

## host.clipboard

`write` is silent; `read` asks the user for permission and rejects if denied.

```js
await context.host.clipboard.write('Hello, world!')

try {
  const text = await context.host.clipboard.read()
} catch (err) {
  // "Clipboard read denied by user"
}
```

## From a WebView

The WebView has none of these. Ask for them:

```js
// index.html
superone.node.postMessage({ type: 'copy', text: 'Hello' })

// node.js
context.webview.onMessage(async (message) => {
  if (message?.type === 'copy') await context.host.clipboard.write(message.text)
})
```
