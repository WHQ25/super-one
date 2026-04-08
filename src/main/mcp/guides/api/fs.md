# superone.fs — File System API

Requires at least one entry in `permissions.fs` (see `permissions` topic). All paths are relative to the declared directories.

## Reading

```js
const content = await superone.fs.readFile('README.md')        // → string
const entries = await superone.fs.readDir('src')               // → [{name, isDir}]
const exists = await superone.fs.exists('package.json')        // → boolean
const files = await superone.fs.glob('**/*.ts')                // → string[]
```

## Writing

Requires `access: "readwrite"` on the directory.

```js
await superone.fs.writeFile('output.md', content)
```

Parent directories are created automatically if they don't exist.

## File Watching

Watch a file or directory for changes. Recursive by default.

```js
const watchId = await superone.fs.watch('src', (event) => {
  console.log(event.type, event.path)  // 'change' | 'rename'
})

superone.fs.unwatch(watchId)  // stop watching
```

All watchers are automatically cleaned up when the mini-app is closed.

## TypeScript Types

```ts
interface SuperOneFsEntry {
  name: string
  isDir: boolean
}

interface SuperOneFsWatchEvent {
  type: 'change' | 'rename'
  path: string
}
```
