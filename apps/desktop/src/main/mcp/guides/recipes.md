# Recipes — MiniApp Host and WebView

## Compute in Node, render in the panel

`node.js`:

```js
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function activate(context) {
  context.subscriptions.push(
    context.tools.handle('analyze_report', async ({ path }) => {
      context.setStatus('Analyzing…')
      try {
        const source = await readFile(join(context.workspace.rootPath, path), 'utf8')
        const result = analyze(source)
        context.webview.postMessage({ type: 'report', result })
        return result
      } finally {
        context.setStatus('')
      }
    }),
  )
}
```

`index.html`:

```js
const dispose = window.superone.node.onMessage((message) => {
  if (message?.type === 'report') renderReport(message.result)
})

refreshButton.onclick = () => {
  window.superone.node.postMessage({ type: 'refresh' })
}
```

## Long-running work

The MiniApp Host already outlives WebViews. Keep long-running jobs there and checkpoint state if it must survive an app restart:

```js
const jobs = new Map()

export function activate(context) {
  context.subscriptions.push(context.webview.onMessage((message) => {
    if (message?.type === 'start') void startJob(message, context)
    if (message?.type === 'query') {
      context.webview.postMessage({ type: 'jobs', jobs: [...jobs.values()] })
    }
  }))
}

async function startJob(message, context) {
  const job = { id: crypto.randomUUID(), progress: 0 }
  jobs.set(job.id, job)
  while (job.progress < 100) {
    await doChunk(message)
    job.progress += 10
    context.setStatus(`Working ${job.progress}%`)
    context.webview.postMessage({ type: 'progress', job })
  }
  context.setStatus('')
}
```

When a panel remounts, send `{ type: "query" }` to resynchronize.

## Confirmation before privileged work

Declare `renderer.intercept` for the confirmation WebView. The MiniApp Host handler receives merged input only after `tool.submit(...)`:

```js
context.tools.handle('apply_changes', async ({ files, confirmed }) => {
  if (!confirmed) throw new Error('Confirmation required')
  return applyChanges(files)
})
```

## CDN UI library

WebViews still use normal browser CSP and CORS rules. Declare a domain in `permissions.network`, then load it normally:

```json
{
  "permissions": {
    "network": [{ "domain": "cdn.jsdelivr.net", "reason": "Load Chart.js" }]
  }
}
```

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

Node-side network calls are not subject to browser CORS. Put secret-bearing or server-to-server clients in the trusted MiniApp Host, never in WebView JavaScript.

## Responsive WebView layout

```css
.container { width: 100%; padding: 16px; }
.grid { display: grid; grid-template-columns: 1fr; gap: 12px; }

@media (min-width: 700px) {
  .grid { grid-template-columns: 1fr 1fr; }
}
```

Use local overflow containers for large tables and charts. The panel and Activity workspace can resize without remounting the MiniApp Host.
