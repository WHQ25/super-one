import { readdir, readFile, writeFile, stat, mkdir, glob, watch } from 'fs/promises'
import { watch as watchSync } from 'fs'
import type { FSWatcher } from 'fs'
import { join, resolve, sep, relative } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from '../logger'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import { parseGitStatusFiles } from '../git-status-utils'
import { parseManifest } from './miniapp-schema'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp, MiniAppFsWatchEvent, MiniAppGitOp } from '../../shared/miniapp-types'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')
const devAppsDir = () => join(process.cwd(), 'examples', 'miniapp')

const workingDirs = new Map<string, string>()

let watchIdCounter = 0
const activeWatchers = new Map<number, { appId: string; controller: AbortController }>()

type WatchEventCallback = (event: MiniAppFsWatchEvent) => void
let watchEventCallback: WatchEventCallback | null = null

export function onFsWatchEvent(cb: WatchEventCallback): void {
  watchEventCallback = cb
}

export function startWatch(appId: string, watchPath: string): number {
  const workingDir = workingDirs.get(appId)
  if (!workingDir) throw new Error(`No working directory set for app: ${appId}`)

  const resolved = resolveSafePath(workingDir, watchPath)

  const watchId = ++watchIdCounter
  const controller = new AbortController()
  activeWatchers.set(watchId, { appId, controller })

  ;(async () => {
    try {
      const watcher = watch(resolved, { recursive: true, signal: controller.signal })
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      const pending = new Map<string, 'change' | 'rename'>()
      const flush = () => {
        for (const [path, type] of pending) {
          watchEventCallback?.({ watchId, appId, type, path })
        }
        pending.clear()
        debounceTimer = null
      }
      for await (const event of watcher) {
        const relPath = event.filename
          ? relative(workingDir, resolve(resolved, event.filename))
          : relative(workingDir, resolved)
        pending.set(relPath, event.eventType as 'change' | 'rename')
        if (!debounceTimer) {
          debounceTimer = setTimeout(flush, 100)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      log.warn(`[miniapp] fs.watch error for ${watchPath}:`, err)
    } finally {
      activeWatchers.delete(watchId)
    }
  })()

  return watchId
}

export function stopWatch(watchId: number): void {
  const entry = activeWatchers.get(watchId)
  if (entry) {
    entry.controller.abort()
    activeWatchers.delete(watchId)
  }
}

function clearWatchersForApp(appId: string): void {
  for (const [id, entry] of activeWatchers) {
    if (entry.appId === appId) {
      entry.controller.abort()
      activeWatchers.delete(id)
    }
  }
}

function resolveSafePath(workingDir: string, relativePath: string): string {
  const resolved = resolve(workingDir, relativePath)
  const normalizedBase = workingDir.endsWith(sep) ? workingDir : workingDir + sep
  if (!resolved.startsWith(normalizedBase) && resolved !== workingDir) {
    throw new Error(`Path traversal blocked: ${relativePath}`)
  }
  return resolved
}

type GitHeadChangeCallback = (event: { appId: string }) => void
let gitHeadChangeCallback: GitHeadChangeCallback | null = null
const gitHeadWatchers = new Map<string, FSWatcher>()

export function onGitHeadChangeEvent(cb: GitHeadChangeCallback): void {
  gitHeadChangeCallback = cb
}

function startGitHeadWatch(appId: string, workingDir: string): void {
  if (gitHeadWatchers.has(appId)) return
  const headPath = join(workingDir, '.git', 'HEAD')
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const watcher = watchSync(headPath, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => gitHeadChangeCallback?.({ appId }), 100)
    })
    watcher.on('error', () => {
      watcher.close()
      gitHeadWatchers.delete(appId)
    })
    gitHeadWatchers.set(appId, watcher)
  } catch { /* not a git repo */ }
}

function stopGitHeadWatch(appId: string): void {
  const watcher = gitHeadWatchers.get(appId)
  if (watcher) {
    watcher.close()
    gitHeadWatchers.delete(appId)
  }
}

export function setWorkingDirectory(appId: string, dir: string): void {
  workingDirs.set(appId, dir)
}

export function clearWorkingDirectory(appId: string): void {
  clearWatchersForApp(appId)
  stopGitHeadWatch(appId)
  workingDirs.delete(appId)
}

async function scanDir(base: string): Promise<MiniAppEntry[]> {
  let dirs: string[]
  try {
    dirs = await readdir(base)
  } catch {
    return []
  }
  const entries: MiniAppEntry[] = []
  for (const name of dirs) {
    const basePath = join(base, name)
    const manifest = await readManifest(basePath)
    if (manifest) {
      entries.push({ id: manifest.appId, manifest, basePath })
    }
  }
  return entries
}

export async function discoverApps(): Promise<MiniAppEntry[]> {
  const entries = await scanDir(userAppsDir())
  if (is.dev) {
    const devEntries = await scanDir(devAppsDir())
    const existingIds = new Set(entries.map((e) => e.id))
    for (const entry of devEntries) {
      if (!existingIds.has(entry.id)) {
        entries.push(entry)
      }
    }
  }
  return entries
}

export async function readManifest(appDir: string): Promise<MiniAppManifest | null> {
  try {
    const raw = await readFile(join(appDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    const result = parseManifest(parsed)
    if (!result.ok) {
      log.warn('[miniapp] invalid manifest in %s: %s', appDir, result.errors.join('; '))
      return null
    }
    return result.manifest as MiniAppManifest
  } catch {
    return null
  }
}

export interface CreateMiniAppOptions {
  name: string
  projectDir: string
  outputDir?: string
  additionalDirs?: string[]
}

const DEV_OUTPUT_DIR = 'dist'

export function getDevAppBasePath(projectDir: string): string {
  return join(projectDir, DEV_OUTPUT_DIR)
}

export async function createMiniApp(opts: CreateMiniAppOptions): Promise<MiniAppEntry> {
  const outputPath = join(opts.projectDir, opts.outputDir ?? DEV_OUTPUT_DIR)
  await mkdir(outputPath, { recursive: true })

  const manifest: MiniAppManifest = {
    appId: '__dev__',
    name: opts.name,
    workingDir: { scope: 'project', path: '.' },
    permissions: { fs: 'project' },
    tools: [
      {
        name: 'show_message',
        description: `Display a message in the ${opts.name} app`,
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The message to display' },
          },
          required: ['text'],
        },
      },
    ],
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${opts.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; padding: 24px; background: #fafaf9; color: #1c1917; }
    .dark body { background: #1c1917; color: #fafaf9; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    #messages { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .msg { background: #fff; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px; }
    .dark .msg { background: #292524; border-color: #44403c; }
    button { background: #f97316; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; }
    button:hover { background: #ea580c; }
    #files { margin-top: 16px; font-size: 13px; color: #78716c; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${opts.name}</h1>
  <div id="messages"><p style="color:#a8a29e">Waiting for agent messages...</p></div>
  <button id="ask-btn">Ask Agent to Greet</button>
  <div id="files"></div>
  <script>
    superone.tools.handle('show_message', function(args) {
      var container = document.getElementById('messages');
      if (container.querySelector('p')) container.innerHTML = '';
      var div = document.createElement('div');
      div.className = 'msg';
      div.textContent = args.text;
      container.appendChild(div);
      return { success: true, displayed: args.text };
    });

    superone.fs.readDir('.').then(function(entries) {
      document.getElementById('files').textContent = 'Files: ' + entries.map(function(e) { return e.name; }).join(', ');
    }).catch(function() {});

    document.getElementById('ask-btn').onclick = function() {
      superone.agent.sendPrompt('Say hello using the ${opts.name.toLowerCase().replace(/\\s+/g, '-')}__show_message tool');
    };
  </script>
</body>
</html>`

  await writeFile(join(outputPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await writeFile(join(outputPath, 'index.html'), html, 'utf-8')

  for (const dir of opts.additionalDirs ?? []) {
    await mkdir(join(opts.projectDir, 'additionalDirs', dir), { recursive: true })
  }

  return { id: '__dev__', manifest, basePath: outputPath }
}

const appBasePathCache = new Map<string, string>()

export function getAppBasePath(appId: string): string {
  const cached = appBasePathCache.get(appId)
  if (cached) return cached
  return join(userAppsDir(), appId)
}

export function cacheAppBasePath(appId: string, basePath: string): void {
  appBasePathCache.set(appId, basePath)
}

export function generateCSP(manifest: MiniAppManifest): string {
  const networkDomains = manifest.permissions?.network ?? []
  const connectSrc = ["'self'", 'superone-app:', ...networkDomains].join(' ')
  const scriptSrc = ["'self'", "'unsafe-inline'", ...networkDomains].join(' ')
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' superone-app: data: blob:`,
    `connect-src ${connectSrc}`,
    `font-src 'self'`,
    `media-src 'self' superone-app: blob:`,
  ].join('; ')
}

export function validatePath(basePath: string, requestedPath: string): string | null {
  const resolved = resolve(basePath, requestedPath.replace(/^\/+/, ''))
  const normalizedBase = basePath.endsWith(sep) ? basePath : basePath + sep
  if (!resolved.startsWith(normalizedBase) && resolved !== basePath) {
    return null
  }
  return resolved
}

export async function handleFsRequest(
  appId: string,
  op: MiniAppFsOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const workingDir = workingDirs.get(appId)
  if (!workingDir) throw new Error(`No working directory set for app: ${appId}`)

  const safe = (p: string) => resolveSafePath(workingDir, p)

  switch (op) {
    case 'readFile': {
      return await readFile(safe(args.path as string), 'utf-8')
    }
    case 'readDir': {
      const p = safe((args.path as string) || '.')
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    }
    case 'writeFile': {
      const p = safe(args.path as string)
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, args.content as string, 'utf-8')
      return undefined
    }
    case 'exists': {
      try {
        await stat(safe(args.path as string))
        return true
      } catch {
        return false
      }
    }
    case 'glob': {
      const pattern = args.pattern as string
      const files: string[] = []
      for await (const entry of glob(pattern, { cwd: workingDir })) {
        files.push(entry)
      }
      return files
    }
    default:
      throw new Error(`Unknown fs operation: ${op}`)
  }
}

export async function handleGitRequest(
  appId: string,
  op: MiniAppGitOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const workingDir = workingDirs.get(appId)
  if (!workingDir) throw new Error(`No working directory set for app: ${appId}`)

  startGitHeadWatch(appId, workingDir)

  switch (op) {
    case 'info': {
      const branchP = gitRun(workingDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
        .catch(() => gitRun(workingDir, ['symbolic-ref', 'HEAD']).then((ref) => ref.replace('refs/heads/', '')))
      const statusP = gitRun(workingDir, ['status', '--porcelain'])
      const [branch, porcelain] = await Promise.all([branchP, statusP])
      const files = porcelain ? porcelain.split('\n').filter(Boolean).length : 0
      if (files === 0) return { branch }
      let insertions = 0, deletions = 0
      try {
        const shortstat = await gitRun(workingDir, ['diff', 'HEAD', '--shortstat'])
        const insMatch = shortstat.match(/(\d+) insertion/)
        const delMatch = shortstat.match(/(\d+) deletion/)
        if (insMatch) insertions = parseInt(insMatch[1])
        if (delMatch) deletions = parseInt(delMatch[1])
      } catch { /* empty */ }
      return { branch, dirty: { files, insertions, deletions } }
    }
    case 'branches': {
      const raw = await gitRun(workingDir, ['branch', '--format=%(refname:short)'])
      return raw ? raw.split('\n').filter(Boolean) : []
    }
    case 'log': {
      const limit = (args.limit as number) || 50
      const raw = await gitRun(workingDir, [
        'log', '--format=%H%x00%P%x00%s%x00%an%x00%ai', `-${limit}`,
      ])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [sha, parents, message, author, date] = line.split('\0')
        return { sha, parents: parents ? parents.split(' ') : [], message, author, date }
      })
    }
    case 'status': {
      const raw = await gitRun(workingDir, ['status', '--porcelain=v1'])
      if (!raw) return []
      return parseGitStatusFiles(raw)
    }
    case 'diff': {
      const filePath = args.path as string
      const staged = args.staged as boolean ?? false
      const gitArgs = staged
        ? ['diff', '--cached', '--', filePath]
        : ['diff', '--', filePath]
      const diff = await gitRun(workingDir, gitArgs)
      return { path: filePath, diff }
    }
    case 'show': {
      const ref = sanitizeGitRef(args.ref as string)
      const filePath = args.path as string
      if (filePath.includes('\0')) throw new Error('Invalid path')
      const content = await gitRun(workingDir, ['show', `${ref}:${filePath}`])
      return { ref, path: filePath, content }
    }
    default:
      throw new Error(`Unknown git operation: ${op}`)
  }
}
