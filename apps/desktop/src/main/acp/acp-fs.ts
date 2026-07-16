import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { RequestError } from '@agentclientprotocol/sdk'
import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest, WriteTextFileResponse } from '@agentclientprotocol/sdk'

export const ACP_FS_MAX_BYTES = 10 * 1024 * 1024

export interface AcpFsContext {
  roots: string[]
  getUnsaved?: (absolutePath: string) => string | null | undefined
}

function normalizeRoots(roots: string[]): string[] {
  const out: string[] = []
  for (const root of roots) {
    if (typeof root !== 'string' || !root.trim()) continue
    out.push(resolve(root))
  }
  return out
}

export function isPathInsideRoot(target: string, root: string): boolean {
  const absTarget = resolve(target)
  const absRoot = resolve(root)
  if (absTarget === absRoot) return true
  const rel = relative(absRoot, absTarget)
  return rel !== '' && !rel.startsWith(`..${sep}`) && !rel.startsWith('..') && !isAbsolute(rel)
}

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch {
    return resolve(p)
  }
}

export async function resolveAllowedPath(
  filePath: string,
  roots: string[],
  opts?: { mustExist?: boolean },
): Promise<string> {
  const normalizedRoots = normalizeRoots(roots)
  if (normalizedRoots.length === 0) {
    throw RequestError.invalidParams({ roots: [] }, 'No filesystem roots configured')
  }
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw RequestError.invalidParams({ path: filePath }, 'Path is required')
  }

  const candidate = isAbsolute(filePath) ? resolve(filePath) : resolve(normalizedRoots[0]!, filePath)
  const realRoots = await Promise.all(normalizedRoots.map((r) => realpathOrSelf(r)))

  const insideByString = realRoots.some((root) => isPathInsideRoot(candidate, root))
    || normalizedRoots.some((root) => isPathInsideRoot(candidate, root))
  if (!insideByString) {
    throw RequestError.invalidParams({ path: candidate }, 'Path is outside allowed workspace roots')
  }

  try {
    const real = await realpath(candidate)
    const rootOk = realRoots.some((root) => isPathInsideRoot(real, root))
    if (!rootOk) {
      throw RequestError.invalidParams({ path: real }, 'Path is outside allowed workspace roots')
    }
    return real
  } catch (err) {
    if (err instanceof RequestError) throw err
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      if (opts?.mustExist) {
        throw RequestError.invalidParams({ path: candidate }, 'File not found')
      }
      const underRoot = realRoots.some((root) => isPathInsideRoot(candidate, root))
        || normalizedRoots.some((root) => isPathInsideRoot(candidate, root))
      if (!underRoot) {
        throw RequestError.invalidParams({ path: candidate }, 'Path is outside allowed workspace roots')
      }
      return candidate
    }
    throw err
  }
}

export function sliceLines(text: string, line?: number | null, limit?: number | null): string {
  if ((line == null || line <= 1) && (limit == null || limit <= 0)) return text
  const lines = text.split('\n')
  const start = Math.max(0, (line ?? 1) - 1)
  if (limit == null || limit <= 0) return lines.slice(start).join('\n')
  return lines.slice(start, start + limit).join('\n')
}

export async function handleReadTextFile(
  params: ReadTextFileRequest,
  ctx: AcpFsContext,
): Promise<ReadTextFileResponse> {
  const absolute = await resolveAllowedPath(params.path, ctx.roots, { mustExist: true })
  let content: string | undefined
  if (ctx.getUnsaved) {
    const fromAbs = ctx.getUnsaved(absolute)
    if (typeof fromAbs === 'string') content = fromAbs
    else {
      const resolvedInput = isAbsolute(params.path)
        ? resolve(params.path)
        : resolve(normalizeRoots(ctx.roots)[0] ?? process.cwd(), params.path)
      const fromInput = ctx.getUnsaved(resolvedInput)
      if (typeof fromInput === 'string') content = fromInput
    }
  }
  if (content === undefined) {
    const info = await stat(absolute)
    if (!info.isFile()) {
      throw RequestError.invalidParams({ path: absolute }, 'Path is not a file')
    }
    if (info.size > ACP_FS_MAX_BYTES) {
      throw RequestError.invalidParams({ path: absolute, size: info.size }, 'File exceeds size limit')
    }
    content = await readFile(absolute, 'utf8')
  }
  return {
    content: sliceLines(content, params.line, params.limit),
  }
}

export async function handleWriteTextFile(
  params: WriteTextFileRequest,
  ctx: AcpFsContext,
): Promise<WriteTextFileResponse> {
  if (typeof params.content !== 'string') {
    throw RequestError.invalidParams({}, 'content is required')
  }
  if (Buffer.byteLength(params.content, 'utf8') > ACP_FS_MAX_BYTES) {
    throw RequestError.invalidParams({}, 'Content exceeds size limit')
  }
  const absolute = await resolveAllowedPath(params.path, ctx.roots, { mustExist: false })
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, params.content, 'utf8')
  return {}
}
