'use strict'

const { readdirSync, statSync, rmSync, existsSync, cpSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }
const PLATFORM_MAP = { darwin: 'darwin', mac: 'darwin', win32: 'win32', windows: 'win32', linux: 'linux' }

// Electron resolves ICU through the Helper path only when the executable
// basename ends in " Helper" (or one of its built-in parenthesized variants).
// Clone the stock Helper.app under semantic names before electron-builder's
// codesign pass; omitting the suffix makes ELECTRON_RUN_AS_NODE SIGTRAP before
// the stdio bridge can receive initialize.
// Keep nameSuffix values in sync with resolve-cli.ts's VARIANT_HELPER_SUFFIX.
const HELPER_VARIANTS = [
  { nameSuffix: 'MCP Helper', bundleName: 'Electron Helper (MCP)', bundleIdSuffix: 'mcp' },
  { nameSuffix: 'LLM Proxy Helper', bundleName: 'Electron Helper (LLM Proxy)', bundleIdSuffix: 'llmproxy' },
]

const COMPUTER_USE_HELPER_NAME = 'SuperOne Computer Use'

function bundleComputerUseHelper(appOutDir, productFilename, archName) {
  const frameworksDir = join(appOutDir, `${productFilename}.app`, 'Contents', 'Frameworks')
  const buildScript = join(__dirname, '..', 'native', 'computer-use-helper', 'scripts', 'build.sh')

  execFileSync('/bin/bash', [buildScript, 'release', archName], {
    env: {
      ...process.env,
      SUPERONE_CU_HELPER_DIST: frameworksDir,
      SUPERONE_CU_SKIP_CODESIGN: '1',
    },
    stdio: 'inherit',
  })

  const helperDir = join(frameworksDir, `${COMPUTER_USE_HELPER_NAME}.app`)
  const helperBinary = join(helperDir, 'Contents', 'MacOS', COMPUTER_USE_HELPER_NAME)
  if (!existsSync(helperBinary)) {
    throw new Error(`[afterPack] Computer Use helper binary missing at ${helperBinary}`)
  }

  const expectedArch = archName === 'x64' ? 'x86_64' : archName
  const binaryArchs = execFileSync('/usr/bin/lipo', ['-archs', helperBinary], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
  if (!binaryArchs.includes(expectedArch)) {
    throw new Error(
      `[afterPack] Computer Use helper architecture mismatch: expected ${expectedArch}, got ${binaryArchs.join(', ')}`,
    )
  }

  console.log(`[afterPack] bundled Computer Use helper for ${archName}: ${helperDir}`)
}

function cloneNamedHelperRuntimes(appOutDir, productFilename) {
  const contentsDir = join(appOutDir, `${productFilename}.app`, 'Contents')
  const frameworksDir = join(contentsDir, 'Frameworks')
  const macosDir = join(contentsDir, 'MacOS')
  const baseName = `${productFilename} Helper`
  const baseDir = join(frameworksDir, `${baseName}.app`)
  if (!existsSync(baseDir)) {
    console.warn(`[afterPack] base helper bundle not found at ${baseDir}, skipping named helpers`)
    return
  }

  for (const { nameSuffix, bundleName, bundleIdSuffix } of HELPER_VARIANTS) {
    const variantName = `${productFilename} ${nameSuffix}`
    const variantDir = join(frameworksDir, `${variantName}.app`)
    rmSync(variantDir, { recursive: true, force: true })
    cpSync(baseDir, variantDir, { recursive: true })
    renameSync(join(variantDir, 'Contents', 'MacOS', baseName), join(variantDir, 'Contents', 'MacOS', variantName))

    const plistPath = join(variantDir, 'Contents', 'Info.plist')
    const setPlistString = (key, value) => {
      execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath])
    }
    setPlistString('CFBundleExecutable', variantName)
    setPlistString('CFBundleDisplayName', variantName)
    setPlistString('CFBundleName', bundleName)
    setPlistString('CFBundleIdentifier', `com.superone.app.helper.${bundleIdSuffix}`)

    console.log(`[afterPack] cloned named helper runtime: ${variantName}`)
  }

  // Remove failed named-runtime experiments from non-clean package directories.
  const stubsDir = join(contentsDir, 'Resources', 'node-runtime-stubs')
  if (existsSync(stubsDir)) {
    rmSync(stubsDir, { recursive: true, force: true })
    console.log('[afterPack] removed obsolete Resources/node-runtime-stubs')
  }
  for (const suffix of ['MCP Bridge', 'LLM Proxy']) {
    const legacySibling = join(macosDir, `${productFilename} ${suffix}`)
    if (existsSync(legacySibling)) {
      rmSync(legacySibling, { force: true })
      console.log(`[afterPack] removed legacy MacOS sibling stub: ${productFilename} ${suffix}`)
    }
    const legacyHelper = join(frameworksDir, `${productFilename} ${suffix}.app`)
    if (existsSync(legacyHelper)) {
      rmSync(legacyHelper, { recursive: true, force: true })
      console.log(`[afterPack] removed legacy helper clone: ${productFilename} ${suffix}.app`)
    }
  }
}

const PRUNE_PARENTS = [
  'node_modules/@anthropic-ai',
  'node_modules/@openai',
  'node_modules/@cursor',
  'node_modules/@napi-rs',
  'node_modules/@img',
]
const PRUNE_PREFIXES = [
  'claude-agent-sdk-',
  'codex-',
  'sdk-',
  'canvas-',
  'sharp-',
]
// The ABI suffix a platform package may carry after its arch. napi-rs names the
// Linux builds `-gnu` / `-musl` and the Windows ones `-msvc`, so matching the bare
// arch would delete the one package this build actually needs.
const KEEP_ABI_SUFFIXES = ['', '-gnu', '-musl', '-msvc', '-gnueabihf']

module.exports = async function afterPack(context) {
  const archName = ARCH_NAMES[context.arch]
  if (!archName || archName === 'universal') return

  const platformKey = (context.packager.platform.nodeName || context.packager.platform.name || '').toLowerCase()
  const osName = PLATFORM_MAP[platformKey]
  if (!osName) return

  const resourcesRoot = osName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
    : join(context.appOutDir, 'resources', 'app.asar.unpacked')

  if (osName === 'darwin') {
    bundleComputerUseHelper(context.appOutDir, context.packager.appInfo.productFilename, archName)
    cloneNamedHelperRuntimes(context.appOutDir, context.packager.appInfo.productFilename)
  }

  const keepSuffix = `${osName}-${archName}`

  let totalFreed = 0
  let removedCount = 0

  for (const parent of PRUNE_PARENTS) {
    const parentDir = join(resourcesRoot, parent)
    let entries
    try { entries = readdirSync(parentDir) } catch { continue }

    let keptHere = 0
    let prunedHere = 0

    for (const entry of entries) {
      const matchesPrefix = PRUNE_PREFIXES.some((p) => entry.startsWith(p))
      if (!matchesPrefix) continue
      if (!entry.includes('-')) continue
      if (KEEP_ABI_SUFFIXES.some((abi) => entry.endsWith(`-${keepSuffix}${abi}`))) { keptHere += 1; continue }
      const looksLikeArchPkg = /-(darwin|win32|linux)-/.test(entry) || /-(darwin|win32|linux)-[a-z0-9_]+$/.test(entry)
      if (!looksLikeArchPkg) continue

      const full = join(parentDir, entry)
      try {
        const size = dirSize(full)
        rmSync(full, { recursive: true, force: true })
        totalFreed += size
        removedCount += 1
        prunedHere += 1
        console.log(`[afterPack] pruned ${entry} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      } catch (err) {
        console.warn(`[afterPack] failed to prune ${entry}:`, err.message)
      }
    }

    // Removing every arch-specific package under a parent means either the keep
    // rule failed to recognise this platform's naming, or the dependency publishes
    // no build for it at all. The first is a bug that surfaces at runtime as a
    // missing native module — usually a blank panel rather than a crash — so fail
    // the build. The second needs a deliberate opt-out here, not a silent pass.
    if (prunedHere > 0 && keptHere === 0) {
      throw new Error(
        `[afterPack] ${parent}: pruned ${prunedHere} package(s) for ${osName}-${archName} and kept none. `
        + `Either KEEP_ABI_SUFFIXES does not cover this package's platform naming, `
        + `or it ships no ${osName}-${archName} build and this parent needs an exemption.`,
      )
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
