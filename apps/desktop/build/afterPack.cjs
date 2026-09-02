'use strict'

const { readdirSync, statSync, rmSync, existsSync, cpSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const VARIANTS = require('../variants.json')

function computerUseHelperBundleId() {
  const id = process.env.SUPERONE_VARIANT
  const entry = VARIANTS[id]
  if (!entry) {
    throw new Error(`[afterPack] SUPERONE_VARIANT "${id}" is not a known variant`)
  }
  return entry.computerUseBundleId
}

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

// The helper is installed outside the app bundle at runtime, so its name and
// bundle id must differ per variant or the stable and alpha apps overwrite and
// pkill each other's helper. Must match releaseHelperAppName() /
// releaseHelperBundleId() in src/main/computer-use/platform/macos-helper-client.ts.
function computerUseHelperName(productFilename) {
  return `${productFilename} Computer Use`
}

function bundleComputerUseHelper(appOutDir, productFilename, archName, helperBundleId) {
  const frameworksDir = join(appOutDir, `${productFilename}.app`, 'Contents', 'Frameworks')
  const buildScript = join(__dirname, '..', 'native', 'computer-use-helper', 'scripts', 'build.sh')
  const helperName = computerUseHelperName(productFilename)

  execFileSync('/bin/bash', [buildScript, 'release', archName], {
    env: {
      ...process.env,
      SUPERONE_CU_HELPER_DIST: frameworksDir,
      SUPERONE_CU_SKIP_CODESIGN: '1',
      SUPERONE_CU_HELPER_APP_NAME: helperName,
      SUPERONE_CU_HELPER_BUNDLE_ID: helperBundleId,
    },
    stdio: 'inherit',
  })

  const helperDir = join(frameworksDir, `${helperName}.app`)
  const helperBinary = join(helperDir, 'Contents', 'MacOS', helperName)
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

function cloneNamedHelperRuntimes(appOutDir, productFilename, appId) {
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
    setPlistString('CFBundleIdentifier', `${appId}.helper.${bundleIdSuffix}`)

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

// Modules the app loads dynamically at runtime: spawned binaries, Cordis
// plugins resolved by string name, optional native addons for ws, and the one
// package src/main imports that looks renderer-only (shiki). No static import
// edge exists for most of these, so a files: exclusion that drops one fails no
// build and no test — it surfaces weeks later as a blank panel or a silently
// degraded feature. Assert their presence right after packing instead.
const MUST_SHIP_IN_ASAR = [
  'node_modules/@musistudio/llms/package.json', // LLM proxy sidecar, forked on demand
  'node_modules/@xterm/headless/package.json',
  'node_modules/@xterm/addon-serialize/package.json',
  'node_modules/@openai/codex/package.json', // launcher for the spawned codex binary
  'node_modules/@cursor/sdk/package.json',
  'node_modules/ws/package.json',
  'node_modules/sharp/package.json', // dep of @deepseek-ai/dsh-attachment-local
  'node_modules/shiki/package.json', // src/main/remote-highlighter.ts
  'node_modules/@shikijs/langs/package.json',
  'node_modules/@deepseek-ai/cordis/package.json',
  'node_modules/@deepseek-ai/cordis-plugin-loader/package.json',
  'node_modules/@deepseek-ai/dsh-attachment-local/package.json',
]
// The dsh harness is ~100 @deepseek-ai/* Cordis plugins, every one loaded by
// string name. A glob that wipes the scope would pass the named checks above.
const MIN_DSH_PACKAGE_COUNT = 90

// Native modules must survive on disk in app.asar.unpacked — checked there
// (not via the asar header) because the wrong-arch prune above deletes from
// disk without rewriting the header.
function mustShipUnpacked(osName, keepSuffix) {
  const paths = [
    'node_modules/better-sqlite3',
    `node_modules/better-sqlite3/prebuilds/${keepSuffix}.node`,
    'node_modules/node-pty',
    'node_modules/utf-8-validate', // ws optional native deps
    'node_modules/bufferutil',
    `node_modules/@img/sharp-${keepSuffix}`,
  ]
  // Windows sharp bundles libvips inside sharp-win32-*; there is no separate
  // libvips package to assert. @cursor/sdk publishes no win32-arm64 build.
  if (osName !== 'win32') paths.push(`node_modules/@img/sharp-libvips-${keepSuffix}`)
  if (keepSuffix !== 'win32-arm64') paths.push(`node_modules/@cursor/sdk-${keepSuffix}`)
  return paths
}

function assertMustShipModules(asarPath, resourcesRoot, osName, keepSuffix) {
  const tree = readAsarTree(asarPath)
  const missing = []

  for (const p of MUST_SHIP_IN_ASAR) {
    if (!asarHasEntry(tree, p)) missing.push(`${p} (asar)`)
  }

  const dshDir = asarGetDir(tree, 'node_modules/@deepseek-ai')
  const dshCount = dshDir ? Object.keys(dshDir.files || {}).length : 0
  if (dshCount < MIN_DSH_PACKAGE_COUNT) {
    missing.push(`node_modules/@deepseek-ai — ${dshCount} packages, expected >= ${MIN_DSH_PACKAGE_COUNT} (asar)`)
  }

  for (const p of mustShipUnpacked(osName, keepSuffix)) {
    if (!existsSync(join(resourcesRoot, p))) missing.push(`${p} (app.asar.unpacked)`)
  }

  if (missing.length > 0) {
    throw new Error(
      `[afterPack] must-ship module check failed — the packaged app is missing:\n`
      + missing.map((m) => `  - ${m}`).join('\n')
      + `\nA files: exclusion in electron-builder.yml (or the wrong-arch prune above) `
      + `removed something the app loads dynamically at runtime.`,
    )
  }
  console.log(`[afterPack] must-ship check passed (${MUST_SHIP_IN_ASAR.length} asar + ${mustShipUnpacked(osName, keepSuffix).length} unpacked entries, ${dshCount} @deepseek-ai packages)`)
}

function readAsarTree(asarPath) {
  const { readSync, openSync, closeSync } = require('node:fs')
  const fd = openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    const buf = Buffer.alloc(headerSize)
    readSync(fd, buf, 0, headerSize, 16)
    return JSON.parse(buf.toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

function asarGetDir(tree, relPath) {
  let node = tree
  for (const seg of relPath.split('/')) {
    node = node.files && node.files[seg]
    if (!node) return null
  }
  return node
}

function asarHasEntry(tree, relPath) {
  return asarGetDir(tree, relPath) !== null
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
    const { productFilename, id: appId } = context.packager.appInfo
    bundleComputerUseHelper(context.appOutDir, productFilename, archName, computerUseHelperBundleId())
    cloneNamedHelperRuntimes(context.appOutDir, productFilename, appId)
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

  // resourcesRoot is <Resources>/app.asar.unpacked; the asar sits beside it.
  assertMustShipModules(join(resourcesRoot, '..', 'app.asar'), resourcesRoot, osName, keepSuffix)
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
