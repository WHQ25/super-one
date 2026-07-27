# superone.peer - Live Instance Events

Use `superone.peer` to exchange ephemeral events between live instances of the same mini-app, such as its panel, standalone tool views, popovers, or background-facing UI. Events are scoped by `appId`; other mini-apps do not receive them.

## Listen and Emit

```js
const unsubscribe = superone.peer.on('selection-changed', (selection) => {
  renderSelection(selection)
})

superone.peer.emit('selection-changed', { ids: ['task-1', 'task-2'] })

// Call when this view is disposed.
unsubscribe()
```

`peer.on(event, callback)` returns an unsubscribe function. `peer.emit(event, payload?)` broadcasts to currently live matching instances.

## Delivery Semantics

- Events are transient: there is no history, retry, acknowledgement, or replay for a view that opens later.
- Payloads should be small, structured-clone-friendly data.
- Event names are app-defined. Use stable names such as `document-updated` and include a version or id in the payload when ordering matters.
- Listener errors are isolated and do not stop delivery to other listeners.

Persist authoritative state in `superone.kv`, `superone.db`, or `superone.fs`. Use peer events only to notify live views that they should refresh that state.
