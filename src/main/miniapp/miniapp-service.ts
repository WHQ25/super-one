import { readdir, readFile, writeFile, stat, mkdir, glob } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { app } from 'electron'
import log from '../logger'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp } from '../../shared/miniapp-types'

const appsDir = () => join(app.getPath('home'), '.superone', 'apps')

const workingDirs = new Map<string, string>()

export function setWorkingDirectory(appId: string, dir: string): void {
  workingDirs.set(appId, dir)
}

export function clearWorkingDirectory(appId: string): void {
  workingDirs.delete(appId)
}

export async function discoverApps(): Promise<MiniAppEntry[]> {
  const base = appsDir()
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

export function getAppBasePath(appId: string): string {
  return join(appsDir(), appId)
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
