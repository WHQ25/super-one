import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { McpAppsError } from '@superone/shared/mcp-apps'

/**
 * `openai/files/open` target: an existing regular file, by its real path, so the
 * project check and the confirmation both see where a link actually points.
 */
export async function resolveMcpAppOpenFile(projectPath: string, path: string): Promise<{ path: string; insideProject: boolean }> {
  let real: string
  try { real = await realpath(path) } catch { throw new McpAppsError('invalid', 'The file does not exist') }
  if (!(await stat(real)).isFile()) throw new McpAppsError('invalid', 'Only files can be opened')
  const root = await realpath(projectPath).catch(() => projectPath)
  const inside = relative(root, real)
  return { path: real, insideProject: !!inside && !inside.startsWith('..') && !isAbsolute(inside) }
}
