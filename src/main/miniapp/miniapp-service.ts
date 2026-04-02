import { readdir, readFile, writeFile, stat, mkdir, glob } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from '../logger'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp } from '../../shared/miniapp-types'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')
const devAppsDir = () => join(process.cwd(), 'examples', 'miniapp')

const workingDirs = new Map<string, string>()

export function setWorkingDirectory(appId: string, dir: string): void {
  workingDirs.set(appId, dir)
}

export function clearWorkingDirectory(appId: string): void {
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
      entries.push({ id: name, manifest, basePath })
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
    if (!parsed.name || typeof parsed.name !== 'string') {
      log.warn('[miniapp] invalid manifest in %s: missing name', appDir)
      return null
    }
    return parsed as MiniAppManifest
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

  const resolveSafe = (relativePath: string): string => {
    const resolved = resolve(workingDir, relativePath)
    const normalizedBase = workingDir.endsWith(sep) ? workingDir : workingDir + sep
    if (!resolved.startsWith(normalizedBase) && resolved !== workingDir) {
      throw new Error(`Path traversal blocked: ${relativePath}`)
    }
    return resolved
  }

  switch (op) {
    case 'readFile': {
      const p = resolveSafe(args.path as string)
      return await readFile(p, 'utf-8')
    }
    case 'readDir': {
      const p = resolveSafe((args.path as string) || '.')
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    }
    case 'writeFile': {
      const p = resolveSafe(args.path as string)
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, args.content as string, 'utf-8')
      return undefined
    }
    case 'exists': {
      const p = resolveSafe(args.path as string)
      try {
        await stat(p)
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
