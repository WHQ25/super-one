import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  main: {
    define: {
      __UPDATER_TOKEN__: JSON.stringify(process.env.UPDATER_TOKEN ?? ''),
      __CF_RELAY_URL__: JSON.stringify(env.SO_CF_RELAY_URL ?? ''),
    },
    build: {
      externalizeDeps: true
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
    plugins: [react(), tailwindcss()]
  }
  }
})
