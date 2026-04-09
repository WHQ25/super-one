# superone system APIs — System & Clipboard

APIs for opening folders, external links, and clipboard access. These are top-level methods on the `superone` object.

## openFolder

Reveal a file or folder in the system file manager (Finder / Explorer). The path is resolved within the app's allowed directories — you cannot open arbitrary paths.

```js
superone.openFolder('.')           // open project root
superone.openFolder('src/utils')   // open a subdirectory
```

## openExternalLink

Open a URL in the user's default browser. A confirmation dialog is shown before opening — the user must approve.

Only `http://` and `https://` URLs are allowed. Other schemes (e.g., `file://`) are blocked.

```js
superone.openExternalLink('https://docs.example.com')
```

## clipboard.write

Write text to the system clipboard. A toast notification is shown to inform the user.

```js
superone.clipboard.write('Hello, world!')
```

## clipboard.read

Read text from the system clipboard. A permission dialog is shown — the user must approve before the app can access clipboard contents. Returns a Promise.

```js
try {
  const text = await superone.clipboard.read()
  console.log('Clipboard:', text)
} catch (err) {
  console.log('Denied or failed:', err.message)
}
```

The Promise rejects if the user denies the request.
