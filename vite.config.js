import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` serves web/ with hot reload and proxies the API to
// `homefinder serve` on :3000. `npm run build` writes dist/, which serve hosts.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
