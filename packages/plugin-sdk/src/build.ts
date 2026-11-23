export const SUPERONE_SHARED_MODULES: readonly string[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'zustand',
  '@superone/ui-slots',
  '@superone/ui-slots/react',
  '@superone/plugin-sdk',
  '@superone/ui/components/ui/button',
  '@superone/ui/components/ui/badge',
  '@superone/ui/lib/utils',
]

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const RESERVED_WORDS = new Set(['default', 'delete', 'class', 'function', 'return', 'var', 'let', 'const', 'import', 'export'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function superoneExternalsPlugin(modules: readonly string[] = SUPERONE_SHARED_MODULES): Bun.BunPlugin {
  const allowed = new Set(modules)
  const filter = new RegExp(`^(${modules.map(escapeRegExp).join('|')})$`)

  return {
    name: 'superone-shared-externals',
    setup(build) {
      build.onResolve({ filter }, (args) => {
        if (!allowed.has(args.path)) return undefined
        return { path: args.path, namespace: 'superone-shared' }
      })

      build.onLoad({ filter: /.*/, namespace: 'superone-shared' }, async (args) => {
        const mod = (await import(args.path)) as Record<string, unknown>
        const namedKeys = Object.keys(mod).filter((k) => IDENT_RE.test(k) && !RESERVED_WORDS.has(k))
        const lines = [
          `const __m = globalThis.__SUPERONE_SHARED__?.[${JSON.stringify(args.path)}];`,
          `if (!__m) throw new Error(${JSON.stringify(`Missing shared module ${args.path} on __SUPERONE_SHARED__`)});`,
          `export default __m.default ?? __m;`,
          ...namedKeys.map((k) => `export const ${k} = __m.${k};`),
        ]
        return { contents: lines.join('\n'), loader: 'js' }
      })
    },
  }
}

export interface BuildPluginClientOptions {
  entrypoints: string[]
  outdir: string
  minify?: boolean
  sourcemap?: 'none' | 'inline' | 'linked' | 'external'
}

export async function buildPluginClient(options: BuildPluginClientOptions) {
  return await Bun.build({
    entrypoints: options.entrypoints,
    outdir: options.outdir,
    format: 'esm',
    target: 'browser',
    minify: options.minify ?? false,
    sourcemap: options.sourcemap ?? 'none',
    plugins: [superoneExternalsPlugin()],
  })
}
