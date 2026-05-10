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
