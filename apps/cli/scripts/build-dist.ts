#!/usr/bin/env node
/**
 * Build a self-contained `superone` distribution tarball for a target platform.
 *
 * Design §15 wants a versioned artifact with a checksum that does not depend on
 * whatever happens to be installed on the host. This build gets most of the way
 * there: all JavaScript (including @superone/shared) is bundled into one file,
 * and native addons are shipped beside the bundle. Bundling a JS runtime is
 * opt-in via --with-node because the Node tarball has to be fetched separately.
 *
 * Usage:
 *   node --import tsx scripts/build-dist.ts [--target linux-x64] [--out dist]
 *                                           [--with-node <node-tarball-or-dir>]
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(CLI_ROOT, '../..')

/** Platforms with a better-sqlite3 Node-API prebuild we can ship. */
export const SUPPORTED_TARGETS = [
  'linux-x64',
  'linux-arm64',
  'linuxmusl-x64',
  'linuxmusl-arm64',
  'darwin-x64',
  'darwin-arm64',
] as const

export type DistTarget = (typeof SUPPORTED_TARGETS)[number]

/** Minimum Node major the bundle is built for. */
export const MIN_NODE_MAJOR = 20

export interface BuildDistOptions {
  target: DistTarget
  outDir: string
  version: string
  /** Optional extracted Node runtime directory to embed. */
  nodeRuntimeDir?: string
}

export interface BuildDistResult {
  target: DistTarget
  version: string
  stageDir: string
  tarballPath: string
  sha256: string
  bytes: number
  bundlesNodeRuntime: boolean
}

/**
 * Launcher script. Prefers an embedded runtime, then `node` on PATH, and fails
 * with an actionable message instead of a confusing syntax error on old Node.
 */
function launcherScript(bundlesNodeRuntime: boolean): string {
  return `#!/bin/sh
# superone launcher — resolves the runtime, then execs the bundled CLI.
set -e
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"

NODE_BIN=""
if [ -x "$ROOT/node/bin/node" ]; then
  NODE_BIN="$ROOT/node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  echo "superone: no JavaScript runtime found." >&2
  echo "Install Node.js ${MIN_NODE_MAJOR} or newer, or use a distribution built with --with-node." >&2
  exit 127
fi

MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$MAJOR" -lt ${MIN_NODE_MAJOR} ]; then
  echo "superone: Node.js ${MIN_NODE_MAJOR}+ required, found $("$NODE_BIN" -v 2>/dev/null || echo unknown)." >&2
  exit 1
fi

exec "$NODE_BIN" "$ROOT/lib/cli.mjs" "$@"
${bundlesNodeRuntime ? '' : ''}`
}

/** Copy only what better-sqlite3 needs at runtime for one target. */
function stageBetterSqlite3(stageDir: string, target: DistTarget): void {
  const src = join(REPO_ROOT, 'node_modules/better-sqlite3')
  const prebuild = join(src, 'prebuilds', `${target}.node`)
  if (!existsSync(prebuild)) {
    throw new Error(
      `missing better-sqlite3 prebuild for ${target} at ${prebuild}. ` +
        `Run bun install, or pick one of: ${SUPPORTED_TARGETS.join(', ')}`,
    )
  }

  const dest = join(stageDir, 'lib/node_modules/better-sqlite3')
  mkdirSync(join(dest, 'prebuilds'), { recursive: true })
  cpSync(join(src, 'lib'), join(dest, 'lib'), { recursive: true })
  cpSync(prebuild, join(dest, 'prebuilds', `${target}.node`))

  // Trim the manifest to what Node's resolver reads; drop install hooks so the
  // artifact can never try to compile on the target host.
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(
    join(dest, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        main: pkg.main,
        license: pkg.license,
      },
      null,
      2,
    ),
  )
}

function stageNodePty(stageDir: string, target: DistTarget): void {
  const src = join(REPO_ROOT, 'node_modules/node-pty')
  const dest = join(stageDir, 'lib/node_modules/node-pty')
  const [targetOs, targetArch] = target.replace('linuxmusl', 'linux').split('-')
  const prebuildDir = join(src, 'prebuilds', `${targetOs}-${targetArch}`)
  const hostTarget = `${process.platform}-${process.arch}`
  const builtDir = join(src, 'build/Release')

  mkdirSync(dest, { recursive: true })
  cpSync(join(src, 'lib'), join(dest, 'lib'), { recursive: true })
  cpSync(join(src, 'package.json'), join(dest, 'package.json'))

  if (existsSync(prebuildDir)) {
    cpSync(prebuildDir, join(dest, 'prebuilds', `${targetOs}-${targetArch}`), {
      recursive: true,
    })
    return
  }
  if (target === hostTarget && existsSync(join(builtDir, 'pty.node'))) {
    cpSync(builtDir, join(dest, 'build/Release'), { recursive: true })
    return
  }
  throw new Error(
    `missing node-pty native build for ${target}. Build this artifact on ${targetOs}-${targetArch} ` +
      `after installing dependencies so node_modules/node-pty/build/Release exists.`,
  )
}

export async function buildDist(options: BuildDistOptions): Promise<BuildDistResult> {
  const { target, outDir, version } = options
  const stageName = `superone-${version}-${target}`
  const stageDir = join(outDir, stageName)

  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(join(stageDir, 'bin'), { recursive: true })
  mkdirSync(join(stageDir, 'lib'), { recursive: true })

  await build({
    entryPoints: [join(CLI_ROOT, 'src/cli.ts')],
    outfile: join(stageDir, 'lib/cli.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: `node${MIN_NODE_MAJOR}`,
    // Native addon: shipped beside the bundle and resolved at runtime.
    external: ['better-sqlite3', 'node-pty'],
    // Inject release version for harness manifest coupling (design §13.3).
    define: {
      __SUPERONE_CLI_VERSION__: JSON.stringify(version),
    },
    banner: {
      js: [
        // CJS deps inside the bundle expect these to exist under ESM.
        "import { createRequire as __superoneCreateRequire } from 'node:module';",
        "import { fileURLToPath as __superoneFileURLToPath } from 'node:url';",
        "import { dirname as __superoneDirname } from 'node:path';",
        'const require = __superoneCreateRequire(import.meta.url);',
        'const __filename = __superoneFileURLToPath(import.meta.url);',
        'const __dirname = __superoneDirname(__filename);',
      ].join('\n'),
    },
    logLevel: 'warning',
  })

  stageBetterSqlite3(stageDir, target)
  stageNodePty(stageDir, target)

  const bundlesNodeRuntime = Boolean(options.nodeRuntimeDir)
  if (options.nodeRuntimeDir) {
    cpSync(options.nodeRuntimeDir, join(stageDir, 'node'), { recursive: true })
  }

  const launcher = join(stageDir, 'bin/superone')
  writeFileSync(launcher, launcherScript(bundlesNodeRuntime))
  chmodSync(launcher, 0o755)

  writeFileSync(
    join(stageDir, 'MANIFEST.json'),
    JSON.stringify(
      {
        name: 'superone',
        version,
        target,
        minNodeMajor: MIN_NODE_MAJOR,
        bundlesNodeRuntime,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  // Deterministic-ish tarball: sorted entries, no owner metadata.
  const tarballPath = join(outDir, `${stageName}.tar.gz`)
  rmSync(tarballPath, { force: true })
  execFileSync(
    'tar',
    ['--numeric-owner', '--owner=0', '--group=0', '-czf', tarballPath, '-C', outDir, stageName],
    { stdio: 'inherit' },
  )

  const bytes = readFileSync(tarballPath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(`${tarballPath}.sha256`, `${sha256}  ${stageName}.tar.gz\n`)

  return {
    target,
    version,
    stageDir,
    tarballPath,
    sha256,
    bytes: bytes.length,
    bundlesNodeRuntime,
  }
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const target = (argValue(args, '--target') || 'linux-x64') as DistTarget
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`unsupported target ${target}; expected one of ${SUPPORTED_TARGETS.join(', ')}`)
  }
  const outDir = resolve(CLI_ROOT, argValue(args, '--out') || 'dist')
  const version =
    argValue(args, '--version') ||
    (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }).version

  mkdirSync(outDir, { recursive: true })
  const result = await buildDist({
    target,
    outDir,
    version,
    nodeRuntimeDir: argValue(args, '--with-node'),
  })

  console.log(
    JSON.stringify(
      {
        tarball: result.tarballPath,
        sha256: result.sha256,
        sizeMb: (result.bytes / 1024 / 1024).toFixed(2),
        bundlesNodeRuntime: result.bundlesNodeRuntime,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
