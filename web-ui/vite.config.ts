import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Built assets are embedded by the Go server under /assets/.
export default defineConfig({
  plugins: [react()],
  base: '/assets/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../internal/server/web/dist'),
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
})
