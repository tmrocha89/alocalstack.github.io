import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Support GH Pages / subpath deploys via env or package name convention.
  // Set VITE_BASE=/your-repo/ when building for GitHub Pages (or use build:pages script).
  // Falls back to '/' for local dev and Docker.
  const base = env.VITE_BASE || '/'

  return {
    base,
    plugins: [react()],
    server: {
      // Allow access when the dev server is reached via Docker Desktop hostnames
      // (kubernetes.docker.internal, host.docker.internal, etc.) or from containers/K8s.
      // Use true for full flexibility in local dev setups.
      allowedHosts: true,
      // Dev proxy for local convenience (avoids CORS during `npm run dev`).
      // The actual endpoint the app talks to at runtime is controlled by the in-app settings.
      proxy: {
        // Health check path
        '/_localstack': {
          target: 'http://kubernetes.docker.internal:4566',
          changeOrigin: true,
        },
      },
    },
    build: {
      // Ensure SPA fallback works on static hosts that serve 404.html (GitHub Pages etc.)
      // Our package.json build script copies index.html -> 404.html after vite build.
      rollupOptions: {
        // (Optional future) input overrides if we ever need multiple entries.
      },
    },
  }
})


