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
