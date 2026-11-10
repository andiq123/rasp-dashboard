import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Built assets are embedded by the Go server under /assets/; dev serves from / so deep links work.
export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), react()],
  base: command === 'build' ? '/assets/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '../internal/server/web/dist'),
    emptyOutDir: true,
    assetsDir: '.',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8484', changeOrigin: true },
    },
  },
}))
