# superone.fs — File System API

Requires at least one entry in `permissions.fs` (see `permissions` topic). All paths are relative to the declared directories.

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
await superone.fs.deleteFile('temp.txt')
await superone.fs.rename('old.txt', 'new.txt')
await superone.fs.mkdir('output/images')                          // recursive
```

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
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  watch(path: string, callback: (event: SuperOneFsWatchEvent) => void): Promise<number>
  unwatch(watchId: number): void
}
```
