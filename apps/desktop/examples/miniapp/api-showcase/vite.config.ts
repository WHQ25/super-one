import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'background.html'),
        confirm: resolve(__dirname, 'confirm.html'),
        receipt: resolve(__dirname, 'receipt.html'),
        counter: resolve(__dirname, 'counter.html'),
        detail: resolve(__dirname, 'detail.html'),
      },
    },
  },
})
