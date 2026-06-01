# superone.fs — File System API

Requires at least one entry in `permissions.fs` (see `permissions` topic). All paths are relative to the declared directories.

## Path Scopes

A **bare** relative path resolves against the **project root** (your `scope: "project"` directories). To reach a non-project scope, prefix the path with `@<scope>/`:

```js
await superone.fs.writeFile('output.md', 'hi')             // → <projectDir>/output.md
await superone.fs.writeFile('@app/state.json', '{}')       // → app data dir
await superone.fs.readFile('@user/.config/my-app/prefs')   // → ~/.config/my-app/prefs
```

- `@project/…` — explicit form of a bare path (project root).
- `@app/…` — the app's data directory (`scope: "app"`).
- `@user/…` — resolves under the home directory (`~`); write the full sub-path, e.g. `@user/.config/my-app/x`.

A bare path is only unambiguous when a `project` scope is declared (or all your scopes share one root). If you declare scopes spanning different roots without a project scope, bare paths are rejected — use an explicit `@<scope>/` prefix.

## Reading

```js
const text = await superone.fs.readFile('README.md')                  // → string
const buf = await superone.fs.readFile('image.png', { binary: true }) // → ArrayBuffer
const entries = await superone.fs.readDir('src')                      // → [{name, isDir}]
const exists = await superone.fs.exists('package.json')               // → boolean
const files = await superone.fs.glob('**/*.ts')                       // → string[]
const info = await superone.fs.stat('data.json')                      // → {size, isDir, isFile, mtime, ctime}
```

## Writing

Requires `access: "readwrite"` on the directory. Supports both text and binary content.

```js
await superone.fs.writeFile('output.md', 'hello world')          // text
await superone.fs.writeFile('image.png', uint8ArrayData)          // binary (Uint8Array)
await superone.fs.writeFile('data.bin', arrayBufferData)          // binary (ArrayBuffer)
```

Parent directories are created automatically if they don't exist.

## File Management

Requires `access: "readwrite"` on the directory.

```js
await superone.fs.deleteFile('temp.txt')                          // permanent removal
await superone.fs.trashFile('temp.txt')                           // move to OS trash (recoverable)
await superone.fs.rename('old.txt', 'new.txt')
await superone.fs.mkdir('output/images')                          // recursive
```

Prefer `trashFile` for user data: it moves the entry to the system trash so the user can restore it. Use `deleteFile` only for throwaway temp files where permanent removal is intended.

## File Watching

Watch a file or directory for changes. Recursive by default.

```js
const watchId = await superone.fs.watch('src', (event) => {
  console.log(event.type, event.path)  // 'change' | 'rename'
})

superone.fs.unwatch(watchId)  // stop watching
```

All watchers are automatically cleaned up when the mini-app is closed.

## Example: Read → Modify → Write JSON

```js
superone.fs.readFile('config.json').then(function(text) {
  var config = JSON.parse(text)
  config.updatedAt = Date.now()
  return superone.fs.writeFile('config.json', JSON.stringify(config, null, 2))
})
```

Requires `permissions.fs` with `"access": "readwrite"` on the target directory.

## TypeScript Types

```ts
interface ReadFileOptions {
  binary?: boolean
}

interface SuperOneFsEntry {
  name: string
  isDir: boolean
}

interface SuperOneFsStat {
  size: number
  isDir: boolean
  isFile: boolean
  mtime: number
  ctime: number
}

interface SuperOneFsWatchEvent {
  type: 'change' | 'rename'
  path: string
}

interface SuperOneFs {
  readFile(path: string): Promise<string>
  readFile(path: string, opts: { binary: true }): Promise<ArrayBuffer>
  writeFile(path: string, content: string | ArrayBuffer | Uint8Array): Promise<void>
  readDir(path?: string): Promise<SuperOneFsEntry[]>
  exists(path: string): Promise<boolean>
  glob(pattern: string): Promise<string[]>
  stat(path: string): Promise<SuperOneFsStat>
  deleteFile(path: string): Promise<void>
  trashFile(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  watch(path: string, callback: (event: SuperOneFsWatchEvent) => void): Promise<number>
  unwatch(watchId: number): void
}
```
