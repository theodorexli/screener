import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Get build date and epoch timestamp
const buildDate = new Date()
const buildEpoch = Math.floor(buildDate.getTime() / 1000) // Epoch in seconds

// Get commit hash (build ID)
let buildId = 'unknown'
try {
  // Get short commit hash (7 characters) for build ID
  const commitHash = execSync('git rev-parse --short HEAD', { 
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
  if (commitHash) {
    buildId = commitHash
  }
} catch (error) {
  // Fallback if git is not available (e.g., in CI/CD or when .git is not present)
  console.warn('Could not get git commit hash, using default')
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Base path for subdomain deployment
  base: '/',
  // Define build-time constants
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_EPOCH__: JSON.stringify(buildEpoch),
  },
  // Proxy configuration - ONLY active in development (vite dev)
  // In production builds, this is ignored and the app uses VITE_WORKER_URL env var
  server: {
    proxy: {
      '/api/predictions': {
        // Default: local predictions worker. Override e.g.
        // PREDICTIONS_PROXY_TARGET=https://your-predictions.workers.dev npm run dev
        target: process.env.PREDICTIONS_PROXY_TARGET || 'http://127.0.0.1:8789',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        // Default: local main worker. Override e.g.
        // WORKER_PROXY_TARGET=https://your-api.workers.dev npm run dev
        target: process.env.WORKER_PROXY_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})

