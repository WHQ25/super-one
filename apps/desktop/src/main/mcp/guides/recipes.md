# Recipes — Cross-API Patterns

Copy-paste-ready patterns that combine multiple APIs. For single-API examples, see the individual API topics.

## Loading a CDN Library

Add a `<script>` tag and declare the CDN domain in `permissions.network`. Without the permission, the browser's Content Security Policy will block the script.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

```json
{
  "permissions": {
    "network": [
      { "domain": "cdn.jsdelivr.net", "reason": "Load Chart.js" }
    ]
  }
}
```

Wait for the library to load before using it:

```js
window.addEventListener('load', function() {
  var ctx = document.getElementById('chart').getContext('2d')
  new Chart(ctx, { type: 'bar', data: { /* ... */ } })
})
```

## Responsive Layout (Panel vs Fullscreen)

Apps run in the activity panel by default (~400–800px wide, resizable). Apps with `fullscreen: true` may also open at the full window width. Use CSS to adapt:

```css
.container { padding: 16px; }

@media (max-width: 300px) {
  .container { padding: 8px; font-size: 13px; }
  .grid { grid-template-columns: 1fr; }
}

@media (min-width: 500px) {
  .grid { grid-template-columns: 1fr 1fr; }
}
```

Use `width: 100%` and `max-width` — never fixed pixel widths. The iframe scrolls internally, so wide content won't break the host layout.

## Multi-Tool Collaboration

Pattern: one tool receives data from the agent, another transforms or filters it.

```json
{
  "toolSlug": "dashboard",
  "tools": [
    {
      "name": "set_data",
      "description": "Set the dataset to display on the dashboard",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "rows": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["title", "rows"]
      }
    },
    {
      "name": "set_filter",
      "description": "Apply a filter to the current dataset",
      "inputSchema": {
        "type": "object",
        "properties": {
          "column": { "type": "string" },
          "value": { "type": "string" }
        },
        "required": ["column", "value"]
      }
    }
  ]
}
```

```js
var currentData = []

superone.tools.handle('set_data', function(args) {
  currentData = args.rows
  render(args.title, currentData)
  return { success: true, rowCount: currentData.length }
})

superone.tools.handle('set_filter', function(args) {
  var filtered = currentData.filter(function(row) {
    return row[args.column] === args.value
  })
  render('Filtered', filtered)
  return { success: true, matchCount: filtered.length }
})
```

## Error Handling with Toast

Combine `superone.fs` (or any async API) with `superone.ui.toast()` for user-facing feedback:

```js
superone.tools.handle('load_file', function(args) {
  return superone.fs.readFile(args.path).then(function(content) {
    display(content)
    superone.ui.toast('File loaded', 'success')
    return { success: true, size: content.length }
  }).catch(function(err) {
    superone.ui.toast(err.message, 'error')
    return { success: false, error: err.message }
  })
})
```

## Standalone Tool (Chat-Inline Iframe)

When a tool's output is a focused inline card (counter, receipt, diff preview) and you don't want the user to keep the panel open, declare `standalone: true` with a `renderer.result.template`. One HTML file registers the handler **and** renders the UI — see the `tools` topic for the full contract.

```json
{
  "toolSlug": "demo",
  "templates": {
    "count-card": "count-card.html"
  },
  "tools": [
    {
      "name": "bump",
      "description": "Increment a persistent counter and show the new value as a card",
      "runningText": "Bumping…",
      "inputSchema": {
        "type": "object",
        "properties": { "by": { "type": "number" } }
      },
      "standalone": true,
      "renderer": { "result": { "template": "count-card" } }
    }
  ]
}
```

```html
<!-- count-card.html -->
<div id="card">…</div>
<script type="module">
  superone.tools.handle('bump', async ({ by }) => {
    const amount = typeof by === 'number' ? by : 1
    const current = (await superone.kv.get('counter')) ?? 0
    const next = current + amount
    await superone.kv.set('counter', next)
    return { previous: current, value: next }
  })

  function render({ result, error }) {
    const card = document.getElementById('card')
    if (error) { card.textContent = String(error); return }
    card.textContent = `${result.previous} → ${result.value}`
  }

  // Live: handler just returned
  window.addEventListener('superone:tool-result', (ev) => render(ev.detail))
  // Replay: iframe re-mounted (scroll), result already cached
  const t = window.superone.tool
  if (t.result !== null || t.error !== null) render({ result: t.result, error: t.error })
</script>
```

Persist state with `superone.kv` (or `superone.fs`) — each call creates a fresh iframe, so in-memory variables don't survive between calls. Pair with `renderer.intercept` to add a confirmation step before the handler runs.
