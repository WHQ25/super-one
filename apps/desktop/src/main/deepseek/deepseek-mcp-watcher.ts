import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { getDshPatchPath, type McpManageOptions } from '@superone/runtime/fs'

/** Editors emit several events per save; coalesce them into one resync. */
const DEFAULT_SETTLE_MS = 150

export interface DshMcpWatchOptions extends McpManageOptions {
  settleMs?: number
}

/**
 * Notify when dsh's own MCP config file changes.
 *
 * SuperOne owns no copy of this list — the harness's profile patch layer is the
 * only source — so an edit made anywhere (our settings page, `dsh` itself, a
 * text editor) has to reach the running tree the same way.
 *
 * Watches the *directory*, not the file: an editor that saves by atomic rename
 * replaces the inode, and a file watch would keep following the old one. Our
 * own writes are in place, but the user's editor is not ours to constrain.
 */
export function watchDshMcpConfig(onChange: () => void, opts?: DshMcpWatchOptions): () => void {
  const filePath = getDshPatchPath(opts)
  const dir = dirname(filePath)
  const filename = basename(filePath)
  const settleMs = opts?.settleMs ?? DEFAULT_SETTLE_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null

  try {
    // The same directory `saveDshMcpConfig` creates on first write. Making it
    // here means a user who adds their first server *after* a session started
    // still gets a live update instead of silence.
    mkdirSync(dir, { recursive: true })
    watcher = watch(dir, (_event, name) => {
      // `name` is null on some platforms; a null name may still be our file.
      if (name && basename(name) !== filename) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, settleMs)
    })
    // A watch error must not take the process down; the next session start
    // re-reads the config anyway.
    watcher.on('error', () => {})
  } catch {
    return () => {}
  }

  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    watcher?.close()
    watcher = null
  }
}
