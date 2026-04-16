# superone UI APIs — Toast, Tooltip, Context Menu, Popover

APIs for rendering overlay UI elements outside the iframe sandbox boundary. All methods are on the `superone.ui` object.

## ui.toast

Show a brief notification message. Fire-and-forget — no return value.

```js
superone.ui.toast('Saved successfully', 'success')
superone.ui.toast('Something went wrong', 'error')
superone.ui.toast('Be careful', 'warning')
superone.ui.toast('FYI', 'info')        // 'info' is the default
superone.ui.toast('Also info')           // type can be omitted
```

| Param | Type | Description |
|-------|------|-------------|
| `message` | `string` | Text to display |
| `type` | `'success' \| 'error' \| 'warning' \| 'info'` | Optional. Defaults to `'info'` |

## ui.showTooltip / ui.hideTooltip

Show a host-rendered tooltip anchored to an element inside the iframe. Call `hideTooltip` when the element is no longer hovered.

```js
element.onmouseenter = () => {
  const rect = element.getBoundingClientRect()
  superone.ui.showTooltip(
    { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    'Tooltip text',
    'top'   // optional: 'top' | 'bottom' | 'left' | 'right'
  )
}
element.onmouseleave = () => {
  superone.ui.hideTooltip()
}
```

| Param | Type | Description |
|-------|------|-------------|
| `anchorRect` | `{ x, y, width, height }` | Bounding rect of the anchor element (from `getBoundingClientRect()`) |
| `text` | `string` | Tooltip content |
| `side` | `'top' \| 'bottom' \| 'left' \| 'right'` | Optional. Defaults to `'top'` |

The tooltip appears outside the iframe and follows the host's theme. Always pair `showTooltip` with `hideTooltip`.

## ui.showContextMenu

Show a context menu at a given position. Returns a Promise that resolves with the selected item's `id`, or `null` if dismissed.

```js
element.oncontextmenu = async (e) => {
  e.preventDefault()
  const selected = await superone.ui.showContextMenu(
    { x: e.clientX, y: e.clientY },
    [
      { id: 'edit', label: 'Edit', icon: 'pencil' },
      { id: 'copy', label: 'Copy', icon: 'copy', group: 'Actions' },
      { id: 'sep', label: '', separator: true },
      { id: 'delete', label: 'Delete', icon: 'trash-2', variant: 'destructive' }
    ]
  )
  if (selected) console.log('Selected:', selected)
}
```

| Param | Type | Description |
|-------|------|-------------|
| `position` | `{ x, y }` | Screen coordinates (typically from `event.clientX/Y`) |
| `items` | `array` | Menu items (see below) |

### Menu Item Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | **Required.** Returned when selected |
| `label` | `string` | **Required.** Display text |
| `icon` | `string` | Lucide icon name in kebab-case (e.g., `'pencil'`, `'trash-2'`, `'folder-input'`) |
| `group` | `string` | Group label. Consecutive items with the same group are visually grouped with a header |
| `variant` | `'default' \| 'destructive'` | `'destructive'` renders in red |
| `disabled` | `boolean` | Greys out the item |
| `separator` | `boolean` | Renders a divider line instead of a menu item |

The menu is dismissed when the user clicks an item, clicks outside, or presses Escape. In all cases the Promise resolves (`id` or `null`).

## Example: Context Menu on List Items

```js
document.querySelectorAll('.item').forEach(function(el) {
  el.oncontextmenu = function(e) {
    e.preventDefault()
    superone.ui.showContextMenu(
      { x: e.clientX, y: e.clientY },
      [
        { id: 'edit', label: 'Edit', icon: 'pencil' },
        { id: 'delete', label: 'Delete', icon: 'trash-2', variant: 'destructive' }
      ]
    ).then(function(id) {
      if (id === 'edit') editItem(el.dataset.id)
      if (id === 'delete') deleteItem(el.dataset.id)
    })
  }
})
```

## ui.showPopover

Show a popover with custom HTML content rendered from a pre-defined template. The popover appears anchored to an element and supports bidirectional communication with the main view.

### Setup

Popover templates are HTML files declared in `manifest.json`:

```json
{
  "appId": "my-app",
  "name": "My App",
  "templates": {
    "detail": "popovers/detail.html",
    "color-picker": "popovers/color-picker.html"
  }
}
```

Create the template files in your app directory. Each template is a full HTML page that gets the complete `superone` API plus a `superone.popover` object for communicating with the main view.

### Usage (main view)

```js
const handle = superone.ui.showPopover({
  template: 'detail',
  data: { itemId: '123', name: 'Hello' },
  anchorRect: element.getBoundingClientRect(),
  side: 'bottom',
  width: 320
})

handle.onMessage(function(msg) {
  if (msg.action === 'save') saveItem(msg.data)
})

handle.onClose(function() {
  console.log('Popover closed')
})
```

| Param | Type | Description |
|-------|------|-------------|
| `template` | `string` | **Required.** Template name from manifest `templates` |
| `data` | `unknown` | Initial data passed to the popover template |
| `anchorRect` | `{ x, y, width, height }` | Anchor element rect (from `getBoundingClientRect()`) |
| `side` | `'top' \| 'bottom' \| 'left' \| 'right'` | Optional. Defaults to `'bottom'` |
| `align` | `'start' \| 'center' \| 'end'` | Optional. Defaults to `'center'` |
| `width` | `number` | Optional. Fixed width in pixels |
| `maxHeight` | `number` | Optional. Maximum height before scrolling |

### PopoverHandle

| Method | Description |
|--------|-------------|
| `postMessage(data)` | Send data to the popover template |
| `onMessage(callback)` | Receive data from the popover template |
| `close()` | Programmatically close the popover |
| `onClose(callback)` | Called when the popover is closed (by user or programmatically) |

### Popover Template API

Inside popover templates, `superone.popover` provides:

```js
// popovers/detail.html
const data = superone.popover.data  // initial data from showPopover()

superone.popover.onMessage(function(msg) {
  // receive messages from main view
})

superone.popover.postMessage({ action: 'save', data: formData })

superone.popover.close()  // close from within the popover
```

Popover templates also have access to the full `superone` API (`fs`, `git`, `ui.toast`, `ui.showTooltip`, `ui.showContextMenu`, `clipboard`, etc.) with the same permissions as the main view.

### Constraints

- Only **one popover** can be open at a time. Opening a new one auto-closes the previous.
- Popovers **cannot open other popovers** (`ui.showPopover` is not available inside templates).
- Popovers **can** use `ui.toast`, `ui.showTooltip`, and `ui.showContextMenu`.
- Height **auto-sizes** to content. Use `maxHeight` to cap it.
- Dismissed by clicking outside or pressing Escape.

### Example: Detail Popover with Two-way Communication

**Main view (index.html):**
```js
button.onclick = function() {
  const rect = button.getBoundingClientRect()
  const handle = superone.ui.showPopover({
    template: 'detail',
    data: { id: item.id, title: item.title },
    anchorRect: rect,
    side: 'bottom',
    align: 'start',
    width: 280
  })
  handle.onMessage(function(msg) {
    if (msg.action === 'delete') {
      deleteItem(msg.id)
      handle.close()
    }
  })
}
```

**Popover template (popovers/detail.html):**
```html
<!DOCTYPE html>
<html>
<head><style>
  body { margin: 0; padding: 12px; font-family: system-ui; }
  h3 { margin: 0 0 8px; }
  button { cursor: pointer; }
</style></head>
<body>
  <h3 id="title"></h3>
  <button id="delete">Delete</button>
  <script>
    document.getElementById('title').textContent = superone.popover.data.title
    document.getElementById('delete').onclick = function() {
      superone.popover.postMessage({ action: 'delete', id: superone.popover.data.id })
    }
  </script>
</body>
</html>
```
