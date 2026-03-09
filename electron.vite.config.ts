import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  main: {
    define: {
      __UPDATER_TOKEN__: JSON.stringify(process.env.UPDATER_TOKEN ?? ''),
      __SUPABASE_URL__: JSON.stringify(env.SO_SUPABASE_URL ?? ''),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(env.SO_SUPABASE_PUBLISHABLE_KEY ?? ''),
    },
    build: {
      externalizeDeps: true
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    define: {
      'import.meta.env.SO_SUPABASE_URL': JSON.stringify(env.SO_SUPABASE_URL ?? ''),
      'import.meta.env.SO_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.SO_SUPABASE_PUBLISHABLE_KEY ?? ''),
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
