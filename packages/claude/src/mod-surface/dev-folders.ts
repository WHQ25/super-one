import { delimiter } from 'node:path'

/**
 * Spawn env that loads mod folders straight from disk and hot-reloads them on
 * save (`CLAUDE_CODE_PLUGIN_DIRS`, `CLAUDE_CODE_PLUGIN_DIR_WATCH`). The CLI asks
 * once per folder before trusting it (`metadata.source: 'mod_hot_reload'`).
 */
export function withModDevFoldersEnv(
  env: Record<string, string | undefined>,
  folders: readonly string[] | undefined,
): Record<string, string | undefined> {
  const dirs = (folders ?? []).filter(Boolean)
  if (dirs.length === 0) return env
  const inherited = env.CLAUDE_CODE_PLUGIN_DIRS?.split(delimiter).filter(Boolean) ?? []
  return {
    ...env,
    CLAUDE_CODE_PLUGIN_DIRS: [...new Set([...inherited, ...dirs])].join(delimiter),
    CLAUDE_CODE_PLUGIN_DIR_WATCH: '1',
  }
}
