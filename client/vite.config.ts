import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    // Sin mapas de código en producción y sin scripts en línea (la CSP los bloquea)
    sourcemap: false,
    assetsInlineLimit: 0
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': process.env.PASSME_API_URL || 'http://localhost:3000'
    }
  }
})
