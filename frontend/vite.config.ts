import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Required for the dev server to be reachable from outside the container.
    host: true,
    watch: { usePolling: true },
  },
})
