import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    global: 'globalThis',
  },
  server: {
    host: true,   // bind to 0.0.0.0 — LAN devices can connect
    port: 5173,
    proxy: {
      // REST API  /api/... → Spring Boot :8080
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // WebSocket /ws → Spring Boot :8080
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
