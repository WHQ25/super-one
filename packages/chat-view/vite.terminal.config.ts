import { defineConfig } from 'vite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { singleDocumentPlugin } from './scripts/single-document-plugin'

const packageDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [singleDocumentPlugin(packageDir, 'dist-terminal', 'terminal.html')],
  base: './',
  build: {
    outDir: 'dist-terminal',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'terminal.html',
      output: { inlineDynamicImports: true },
    },
  },
})
