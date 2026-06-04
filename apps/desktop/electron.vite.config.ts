import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
const mainExternalDeps = [
  ...Object.keys(pkg.dependencies ?? {}).filter((dep) => dep !== '@superone/shared'),
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
    },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: mainExternal,
        input: {
          index: resolve('src/main/index.ts'),
          'superone-mcp-stdio-bridge': resolve('src/main/mcp/superone-mcp-stdio-bridge.ts'),
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
          'worker-host-preload': resolve('src/preload/worker-host-preload.ts'),
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
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'worker-host': resolve('src/renderer/worker-host.html'),
        },
        output: {
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
