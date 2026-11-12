import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { patchDocxViewerSource, patchXlsxViewerSource } from './src/main/office-viewer-transform'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
// Workspace packages ship TypeScript source via package exports. Bundle them
// into main (same as @superone/shared) — do not externalize, or Electron/Node
// ESM fails on extensionless relative imports inside those packages.
const mainExternalDeps = [
  ...Object.keys(pkg.dependencies ?? {}).filter((dep) => !dep.startsWith('@superone/')),
  'electron',
]
const mainExternal = [
  ...mainExternalDeps,
  new RegExp(`^(${mainExternalDeps.map(escapeRegExp).join('|')})/.+`),
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  main: {
    define: {
      __CF_RELAY_URL__: JSON.stringify(env.SO_CF_RELAY_URL ?? ''),
      __POSTHOG_PROJECT_TOKEN__: JSON.stringify(env.POSTHOG_PROJECT_TOKEN ?? ''),
      __POSTHOG_HOST__: JSON.stringify(env.POSTHOG_HOST ?? ''),
    },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: mainExternal,
        input: {
          bootstrap: resolve('src/main/bootstrap.ts'),
          index: resolve('src/main/index.ts'),
          'superone-mcp-stdio-bridge': resolve('src/main/mcp/superone-mcp-stdio-bridge.ts'),
          'llm-proxy-entry': resolve('src/main/providers/llm-proxy-entry.ts'),
          'miniapp-host-entry': resolve('src/main/miniapp/miniapp-host-entry.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve('src/preload/index.ts'),
          'miniapp-preload': resolve('src/preload/miniapp-preload.ts'),
          'webmcp-preload': resolve('src/preload/webmcp-preload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __POSTHOG_PROJECT_TOKEN__: JSON.stringify(env.POSTHOG_PROJECT_TOKEN ?? ''),
      __POSTHOG_HOST__: JSON.stringify(env.POSTHOG_HOST ?? ''),
    },
    server: {
      port: parseInt(process.env.VITE_PORT || '5173'),
      strictPort: true
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    // These packages start workers with `new Worker(new URL("./…-worker.js", import.meta.url))`.
    // Vite rewrites that only when it transforms the module. Prebundling drops the pattern,
    // and a missing worker script does not fall back for pptx.
    optimizeDeps: {
      exclude: ['@extend-ai/react-docx', '@extend-ai/react-xlsx', '@extend-ai/react-pptx'],
      // The excluded packages stay source modules, so Vite would otherwise serve
      // their CJS dependencies raw. utif and regl have no ESM default export
      // (`import UTIF from "utif"` then throws). Prebundling restores interop.
      // topojson-client is included for the same reason. Restart the dev server
      // after changing this list so Vite rebuilds the dep cache.
      include: ['utif', 'regl', 'topojson-client'],
    },
    plugins: [
      // Vite bundles `new Worker(new URL(..., import.meta.url))` as an iife.
      // That format cannot code-split, and these two workers blow the build:
      // xlsx dynamically imports its WASM package, and docx pulls the layout
      // graph. Neither worker is used. xlsx parses on the main thread
      // (`useWorker: false`). docx tries the worker, catches this throw, and
      // parses on the main thread. The same xlsx transform paints a column or
      // row drag before pointerup. pptx has no main-thread switch, so its
      // worker is still bundled. Restart the dev server after changing this.
      {
        name: 'office-skip-unusable-workers',
        enforce: 'pre' as const,
        transform(code: string, id: string) {
          if (id.includes('/@extend-ai/react-xlsx/') && id.endsWith('index.js')) {
            const result = patchXlsxViewerSource(code)
            if (result.missing.length > 0) {
              this.warn(`@extend-ai/react-xlsx patch missed ${result.missing.join(', ')}`)
            }
            return result.code === code ? null : result.code
          }
          if (id.includes('/@extend-ai/react-docx/') && id.endsWith('index.js')) {
            const result = patchDocxViewerSource(code)
            if (result.missing.length > 0) {
              this.warn(`@extend-ai/react-docx patch missed ${result.missing.join(', ')}`)
            }
            return result.code === code ? null : result.code
          }
          return null
        },
      },
      react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          bench: resolve('src/renderer/bench.html'),
        },
        output: {
          // Only eager vendors belong here. Lazy libraries (mermaid, recharts, xterm…)
          // are split by their dynamic imports; a manual chunk for one also absorbs
          // shared helpers such as `__vitePreload`, so the entry statically imports
          // the whole library and pays for it at startup.
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react/jsx-runtime') ||
              id.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor'
            }
          }
        }
      }
    }
  }
  }
})
