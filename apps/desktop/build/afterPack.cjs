'use strict'

const { readdirSync, statSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
const PLATFORM_MAP = { darwin: 'darwin', mac: 'darwin', win32: 'win32', windows: 'win32', linux: 'linux' }

const PRUNE_PARENTS = [
  'node_modules/@anthropic-ai',
  'node_modules/@openai',
]
const PRUNE_PREFIXES = [
  'claude-agent-sdk-',
  'codex-',
]

module.exports = async function afterPack(context) {
  const archName = ARCH_NAMES[context.arch]
  if (!archName || archName === 'universal') return

  const platformKey = (context.packager.platform.nodeName || context.packager.platform.name || '').toLowerCase()
  const osName = PLATFORM_MAP[platformKey]
  if (!osName) return

  const resourcesRoot = osName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
    : join(context.appOutDir, 'resources', 'app.asar.unpacked')

  const keepSuffix = `${osName}-${archName}`

  let totalFreed = 0
  let removedCount = 0

  for (const parent of PRUNE_PARENTS) {
    const parentDir = join(resourcesRoot, parent)
    let entries
    try { entries = readdirSync(parentDir) } catch { continue }

    for (const entry of entries) {
      const matchesPrefix = PRUNE_PREFIXES.some((p) => entry.startsWith(p))
      if (!matchesPrefix) continue
      if (!entry.includes('-')) continue
      if (entry.endsWith(`-${keepSuffix}`) || entry.endsWith(`-${keepSuffix}-musl`)) continue
      const looksLikeArchPkg = /-(darwin|win32|linux)-/.test(entry) || /-(darwin|win32|linux)-[a-z0-9_]+$/.test(entry)
      if (!looksLikeArchPkg) continue

      const full = join(parentDir, entry)
      try {
        const size = dirSize(full)
        rmSync(full, { recursive: true, force: true })
        totalFreed += size
        removedCount += 1
        console.log(`[afterPack] pruned ${entry} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      } catch (err) {
        console.warn(`[afterPack] failed to prune ${entry}:`, err.message)
      }
    }
  }

  console.log(`[afterPack] removed ${removedCount} wrong-arch packages, freed ${(totalFreed / 1024 / 1024).toFixed(1)} MB for ${osName}-${archName}`)
}

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try { st = statSync(cur) } catch { continue }
    if (st.isDirectory()) {
      let kids
      try { kids = readdirSync(cur) } catch { continue }
      for (const k of kids) stack.push(join(cur, k))
    } else {
      total += st.size
    }
  }
  return total
}
