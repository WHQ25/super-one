#!/usr/bin/env node
/**
 * Build a publishable npm package for `@super-one/cli`.
 *
 * Monorepo workspace packages (`@superone/*`) are bundled into one ESM file so
 * the published package has no `workspace:*` dependencies. Native addons and
 * the Claude / Cursor Agent SDKs stay external and are installed by npm on the host.
 *
 * Output: apps/cli/dist/npm/  (ready for `npm publish`)
 *
 * Usage:
 *   bun run pack:npm
 *   bun run pack:npm -- --version 0.49.5-alpha.1
 *   bun run pack:npm -- --publish --tag alpha
 *   bun run pack:npm -- --dry-run   # npm pack only
 */

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(CLI_ROOT, '../..')
const OUT_DIR = join(CLI_ROOT, 'dist', 'npm')
const MIN_NODE_MAJOR = 20

/** Public product name (design §15.1). Workspace stays `@superone/cli`. */
export const PUBLIC_CLI_PACKAGE = '@super-one/cli'
export const PUBLIC_CLI_BIN = 'superone'

const CLAUDE_SDK_VERSION = '0.3.257'
const CURSOR_SDK_VERSION = '1.0.27'

const OPTIONAL_CLAUDE_PLATFORMS = [
  `@anthropic-ai/claude-agent-sdk-darwin-arm64`,
  `@anthropic-ai/claude-agent-sdk-darwin-x64`,
  `@anthropic-ai/claude-agent-sdk-linux-x64`,
  `@anthropic-ai/claude-agent-sdk-linux-arm64`,
  `@anthropic-ai/claude-agent-sdk-linux-x64-musl`,
  `@anthropic-ai/claude-agent-sdk-linux-arm64-musl`,
  `@anthropic-ai/claude-agent-sdk-win32-x64`,
  `@anthropic-ai/claude-agent-sdk-win32-arm64`,
] as const

const OPTIONAL_CURSOR_PLATFORMS = [
  `@cursor/sdk-darwin-arm64`,
  `@cursor/sdk-darwin-x64`,
  `@cursor/sdk-linux-arm64`,
  `@cursor/sdk-linux-x64`,
  `@cursor/sdk-win32-x64`,
] as const

function readRootVersion(): string {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version?: string
  }
  if (!raw.version?.trim()) throw new Error('root package.json missing version')
  return raw.version.trim()
}

function distTagForVersion(version: string): 'alpha' | 'beta' | 'latest' {
  if (/-alpha(\.|$)/i.test(version) || version.includes('-alpha')) return 'alpha'
  if (/-beta(\.|$)/i.test(version) || version.includes('-beta')) return 'beta'
  if (/-rc(\.|$)/i.test(version)) return 'latest' // treat rc as latest-track pin if ever used
  return 'latest'
}

function assertSafePublishVersion(version: string, tag: string): void {
  const isPre =
    /-(alpha|beta|rc)(\.|$)/i.test(version) ||
    version.includes('-alpha') ||
    version.includes('-beta')
  if (isPre && tag === 'latest') {
    throw new Error(
      `refusing to publish pre-release ${version} with dist-tag "latest" (design §15.4)`,
    )
  }
}

function buildPublishPackageJson(version: string): Record<string, unknown> {
  const optionalDependencies: Record<string, string> = {}
  for (const name of OPTIONAL_CLAUDE_PLATFORMS) {
    optionalDependencies[name] = CLAUDE_SDK_VERSION
  }
  for (const name of OPTIONAL_CURSOR_PLATFORMS) {
    optionalDependencies[name] = CURSOR_SDK_VERSION
  }

  return {
    name: PUBLIC_CLI_PACKAGE,
    version,
    description: 'SuperOne headless node CLI — remote execution environment (RPC, workspaces, sessions).',
    type: 'module',
    license: 'BUSL-1.1',
    bin: {
      // npm cleans names that look like extensions; keep bare command name.
      [PUBLIC_CLI_BIN]: 'bin/superone.mjs',
    },
    files: ['bin', 'lib', 'README.md', 'MANIFEST.json'],
    engines: {
      node: `>=${MIN_NODE_MAJOR}`,
    },
    publishConfig: {
      access: 'public',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/WHQ25/super-one.git',
      directory: 'apps/cli',
    },
    // Natives + Agent SDKs stay external so npm installs platform binaries.
    dependencies: {
      '@anthropic-ai/claude-agent-sdk': CLAUDE_SDK_VERSION,
      '@cursor/sdk': CURSOR_SDK_VERSION,
      'better-sqlite3': '^13.0.1',
      'node-pty': '^1.0.0',
    },
    optionalDependencies,
  }
}

export interface PackNpmResult {
  outDir: string
  version: string
  packageName: string
  tarballPath?: string
}

export async function packNpm(options: {
  version?: string
  outDir?: string
}): Promise<PackNpmResult> {
  const version = options.version?.trim() || readRootVersion()
  const outDir = resolve(options.outDir || OUT_DIR)

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'bin'), { recursive: true })
  mkdirSync(join(outDir, 'lib'), { recursive: true })

  const externalList = [
    'better-sqlite3',
    'node-pty',
    '@anthropic-ai/claude-agent-sdk',
    ...OPTIONAL_CLAUDE_PLATFORMS,
    // Cursor SDK ships platform natives + prebundled chunks that esbuild cannot
    // rebundle (`.map` loaders, `bun:sqlite`, missing d.ts side files).
    '@cursor/sdk',
    ...OPTIONAL_CURSOR_PLATFORMS,
  ]

  await build({
    entryPoints: [join(CLI_ROOT, 'src/cli.ts')],
    outfile: join(outDir, 'lib/cli.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: `node${MIN_NODE_MAJOR}`,
    // Natives + Claude/Cursor Agent SDKs stay external (npm installs platform binaries).
    external: externalList,
    define: {
      __SUPERONE_CLI_VERSION__: JSON.stringify(version),
    },
    banner: {
      js: [
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

  const launcher = `#!/usr/bin/env node
/**
 * ${PUBLIC_CLI_PACKAGE} bin — loads the bundled CLI.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
await import(pathToFileURL(join(here, '..', 'lib', 'cli.mjs')).href)
`
  const binPath = join(outDir, 'bin', 'superone.mjs')
  writeFileSync(binPath, launcher)
  chmodSync(binPath, 0o755)

  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify(buildPublishPackageJson(version), null, 2) + '\n',
  )

  writeFileSync(
    join(outDir, 'MANIFEST.json'),
    JSON.stringify(
      {
        name: PUBLIC_CLI_PACKAGE,
        version,
        kind: 'npm',
        minNodeMajor: MIN_NODE_MAJOR,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )

  const readmeSrc = join(CLI_ROOT, 'README.md')
  if (existsSync(readmeSrc)) {
    cpSync(readmeSrc, join(outDir, 'README.md'))
  } else {
    writeFileSync(
      join(outDir, 'README.md'),
      `# ${PUBLIC_CLI_PACKAGE}\n\nSuperOne headless node CLI.\n\n\`\`\`bash\nnpm install -g ${PUBLIC_CLI_PACKAGE}@${version}\nsuperone start\n\`\`\`\n`,
    )
  }

  return {
    outDir,
    version,
    packageName: PUBLIC_CLI_PACKAGE,
  }
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const version = argValue(args, '--version')
  const tagArg = argValue(args, '--tag')
  const doPublish = args.includes('--publish')
  const dryRun = args.includes('--dry-run')

  const result = await packNpm({ version })
  const tag = tagArg || distTagForVersion(result.version)
  assertSafePublishVersion(result.version, tag)

  // Smoke: package is loadable enough that package.json parses.
  const pkg = JSON.parse(readFileSync(join(result.outDir, 'package.json'), 'utf8')) as {
    name: string
    version: string
  }
  if (pkg.name !== PUBLIC_CLI_PACKAGE) {
    throw new Error(`pack wrote wrong package name: ${pkg.name}`)
  }

  console.log(
    JSON.stringify(
      {
        outDir: result.outDir,
        name: result.packageName,
        version: result.version,
        distTag: tag,
        cliBytes: readFileSync(join(result.outDir, 'lib', 'cli.mjs')).length,
        sha256: createHash('sha256')
          .update(readFileSync(join(result.outDir, 'lib', 'cli.mjs')))
          .digest('hex'),
      },
      null,
      2,
    ),
  )

  if (dryRun) {
    const tgz = execFileSync('npm', ['pack', '--json'], {
      cwd: result.outDir,
      encoding: 'utf8',
    })
    console.log(tgz)
    return
  }

  if (doPublish) {
    execFileSync(
      'npm',
      ['publish', '--access', 'public', '--tag', tag],
      { cwd: result.outDir, stdio: 'inherit', env: process.env },
    )
    console.log(`published ${PUBLIC_CLI_PACKAGE}@${result.version} (tag ${tag})`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
