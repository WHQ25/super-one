# superone UI APIs — Toast, Tooltip, Context Menu

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
