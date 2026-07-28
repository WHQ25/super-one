/**
 * Best-effort +x on platform agent CLIs after electron-rebuild.
 * Never fails the install — missing optional packages are normal on CI
 * before prepare:*-optional-deps, and Windows bun shell rejects bash
 * brace groups / unmatched globs in package.json postinstall.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const nm = join(import.meta.dirname, '../../..', 'node_modules')

function tryChmod(filePath) {
  try {
    if (!existsSync(filePath)) return
    if (statSync(filePath).isDirectory()) return
    chmodSync(filePath, 0o755)
  } catch {
    // ignore — optional bins / non-unix FS
  }
}

function chmodUnderScope(scope, dirPrefix, fileNames) {
  const scopeDir = join(nm, scope)
  if (!existsSync(scopeDir)) return
  for (const entry of readdirSync(scopeDir)) {
    if (!entry.startsWith(dirPrefix)) continue
    const pkgDir = join(scopeDir, entry)
    for (const name of fileNames) {
      tryChmod(join(pkgDir, name))
    }
    // codex packages ship versioned binaries (codex, codex-x86_64-pc-windows-msvc, …)
    try {
      for (const file of readdirSync(pkgDir)) {
        if (file === 'codex' || file.startsWith('codex-')) tryChmod(join(pkgDir, file))
      }
    } catch {
      // ignore
    }
  }
}

chmodUnderScope('@anthropic-ai', 'claude-agent-sdk', ['claude'])
chmodUnderScope('@openai', 'codex', ['codex'])
