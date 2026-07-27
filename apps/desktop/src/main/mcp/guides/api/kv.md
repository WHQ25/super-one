# superone.kv - Key-Value Storage

Use `superone.kv` for small JSON-serializable values that do not need SQL queries. It uses the same private SQLite storage and project/user scopes as `superone.db`, but exposes a simpler key-value API. No manifest permission is required.

## Scopes

| Accessor | Scope | Use for |
|---|---|---|
| `superone.kv` / `superone.kv.project` | Current project or repository | Project-specific preferences, checkpoints, and lightweight state |
| `superone.kv.user` | Current user across all projects | Personal defaults and cross-project state |

Project scope follows the repository root, so its values are shared by worktrees. It throws when no project is open; use user scope for mini-apps that must also work without a project.

## API

```js
await superone.kv.set('filters/current', { owner: 'me', open: true })

const filters = await superone.kv.get('filters/current')
const filterKeys = await superone.kv.list('filters/')

await superone.kv.delete('filters/current')
```

| Method | Result |
|---|---|
| `get(key)` | Stored value, or `undefined` when absent |
| `set(key, value)` | Stores a JSON-serializable value |
| `delete(key)` | Removes the key; deleting a missing key is safe |
| `list(prefix?)` | Sorted key names, optionally filtered by prefix |

## Constraints

- Values must be JSON-serializable. Do not store functions, cyclic objects, `BigInt`, or `undefined`.
- Use namespaced keys such as `view/layout` or `jobs/<id>/checkpoint` to make prefix listing useful.
- This is local persistence, not cross-device sync or a multi-user database.
- Use `superone.db` when you need indexes, filtering, atomic batches, or relationships between records.
